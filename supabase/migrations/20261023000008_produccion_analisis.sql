-- ProdControl · 008 — historial, tiempos estándar y alertas automáticas

-- Historial: todas las tareas con tiempos (efectivos, sin pausas) y nombres de operarias.
-- "dia" = fecha en Montevideo de fin (si terminó), si no de inicio, si no de creación.
create view produccion.v_historial with (security_invoker = true) as
with nombres as (
  select o.empleado_id, f.nombre
  from produccion.operarias o
  join core.funcionarios f on f.id = o.empleado_id
)
select
  'fabricacion'::text as entidad, f.id, f.estado,
  p.nombre as producto, p.color, t.codigo as tanque_codigo,
  null::text as presentacion, null::int as cantidad, f.litros, null::numeric as litros_equiv,
  f.lote, null::text as descripcion,
  f.operaria_id as operaria_1, n1.nombre as operaria_1_nombre,
  null::uuid as operaria_2, null::text as operaria_2_nombre,
  f.inicio, f.fin, f.created_at,
  te.min_brutos, te.min_pausa, te.min_efectivos,
  (coalesce(f.fin, f.inicio, f.created_at) at time zone 'America/Montevideo')::date as dia
from produccion.fabricaciones f
join produccion.productos p on p.id = f.producto_id
join produccion.tanques t on t.id = f.tanque_id
left join nombres n1 on n1.empleado_id = f.operaria_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fabricacion' and te.entidad_id = f.id
union all
select
  'envasado', v.id, v.estado,
  p.nombre, p.color, t.codigo,
  pe.nombre, v.cantidad, v.cantidad * pe.litros_equiv, pe.litros_equiv,
  f.lote, null::text,
  v.operaria_1, n1.nombre, v.operaria_2, n2.nombre,
  v.inicio, v.fin, v.created_at,
  te.min_brutos, te.min_pausa, te.min_efectivos,
  (coalesce(v.fin, v.inicio, v.created_at) at time zone 'America/Montevideo')::date
from produccion.envasados v
join produccion.fabricaciones f on f.id = v.fabricacion_id
join produccion.productos p on p.id = f.producto_id
join produccion.tanques t on t.id = f.tanque_id
join produccion.presentaciones pe on pe.id = v.presentacion_id
left join nombres n1 on n1.empleado_id = v.operaria_1
left join nombres n2 on n2.empleado_id = v.operaria_2
left join produccion.v_tiempos_efectivos te on te.entidad = 'envasado' and te.entidad_id = v.id
union all
select
  'fraccionado', x.id, x.estado,
  coalesce(p.nombre, x.descripcion), p.color, null::text,
  pe.nombre, x.cantidad, x.cantidad * pe.litros_equiv, pe.litros_equiv,
  x.lote, x.descripcion,
  x.operaria_id, n1.nombre, null::uuid, null::text,
  x.inicio, x.fin, x.created_at,
  te.min_brutos, te.min_pausa, te.min_efectivos,
  (coalesce(x.fin, x.inicio, x.created_at) at time zone 'America/Montevideo')::date
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join nombres n1 on n1.empleado_id = x.operaria_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id;

grant select on produccion.v_historial to authenticated;

-- Velocidades históricas (base de las proyecciones y del desvío): fabricación en L/min por
-- producto, envasado en unidades/min por presentación. Solo tareas terminadas con tiempo real.
create view produccion.v_tiempos_estandar with (security_invoker = true) as
select
  'fabricacion'::text as entidad, p.nombre as clave,
  avg(f.litros / te.min_efectivos) as velocidad,
  count(*)::int as muestras,
  max(p.litros_hora_std) as litros_hora_std
from produccion.fabricaciones f
join produccion.productos p on p.id = f.producto_id
join produccion.v_tiempos_efectivos te on te.entidad = 'fabricacion' and te.entidad_id = f.id
where f.estado = 'finalizada' and te.fin is not null and te.min_efectivos > 0.1
group by p.nombre
union all
select
  'envasado', pe.nombre,
  avg(v.cantidad / te.min_efectivos),
  count(*)::int,
  null::numeric
from produccion.envasados v
join produccion.presentaciones pe on pe.id = v.presentacion_id
join produccion.v_tiempos_efectivos te on te.entidad = 'envasado' and te.entidad_id = v.id
where v.estado = 'finalizado' and te.fin is not null and te.min_efectivos > 0.1
group by pe.nombre;

grant select on produccion.v_tiempos_estandar to authenticated;

-- Alertas: tipos de la app vieja y una sola por (tipo, tarea) ---------------------
alter table produccion.alertas drop constraint alertas_tipo_check;
alter table produccion.alertas add constraint alertas_tipo_check
  check (tipo in ('exceso_9h', 'desvio_estandar', 'pausa_larga', 'falta_envasado'));
create unique index alertas_tipo_entidad_uk on produccion.alertas (tipo, entidad_id);

create function produccion.revisar_alertas() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_total int := 0;
  v_n int;
begin
  -- Más de 9 h desde el inicio (fabricación o envasado sin terminar)
  insert into produccion.alertas (tipo, entidad, entidad_id, texto)
  select 'exceso_9h', 'fabricacion', f.id,
         format('Fabricación de %s en %s lleva más de 9 horas.', p.nombre, t.codigo)
  from produccion.fabricaciones f
  join produccion.productos p on p.id = f.producto_id
  join produccion.tanques t on t.id = f.tanque_id
  where f.estado in ('fabricando', 'pausada') and f.inicio < now() - interval '9 hours'
  on conflict (tipo, entidad_id) do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into produccion.alertas (tipo, entidad, entidad_id, texto)
  select 'exceso_9h', 'envasado', v.id,
         format('Envasado de %s (%s) lleva más de 9 horas.', p.nombre, pe.nombre)
  from produccion.envasados v
  join produccion.fabricaciones f on f.id = v.fabricacion_id
  join produccion.productos p on p.id = f.producto_id
  join produccion.presentaciones pe on pe.id = v.presentacion_id
  where v.estado in ('activo', 'pausado') and v.inicio < now() - interval '9 hours'
  on conflict (tipo, entidad_id) do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- Envasado pausado hace más de 30 min (desde la última pausa)
  insert into produccion.alertas (tipo, entidad, entidad_id, texto)
  select 'pausa_larga', 'envasado', v.id,
         format('Envasado de %s (%s) lleva más de 30 min pausado.', p.nombre, pe.nombre)
  from produccion.envasados v
  join produccion.fabricaciones f on f.id = v.fabricacion_id
  join produccion.productos p on p.id = f.producto_id
  join produccion.presentaciones pe on pe.id = v.presentacion_id
  join lateral (
    select max(e.at) as at from produccion.eventos e
    where e.entidad = 'envasado' and e.entidad_id = v.id and e.accion = 'pausar'
  ) ps on true
  where v.estado = 'pausado' and ps.at < now() - interval '30 minutes'
  on conflict (tipo, entidad_id) do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- Envasado activo que superó el tiempo estimado por la velocidad histórica
  insert into produccion.alertas (tipo, entidad, entidad_id, texto)
  select 'desvio_estandar', 'envasado', v.id,
         format('Envasado de %s (%s) superó el tiempo estimado (%s min).',
                p.nombre, pe.nombre, round(v.cantidad / s.velocidad))
  from produccion.envasados v
  join produccion.fabricaciones f on f.id = v.fabricacion_id
  join produccion.productos p on p.id = f.producto_id
  join produccion.presentaciones pe on pe.id = v.presentacion_id
  join produccion.v_tiempos_estandar s on s.entidad = 'envasado' and s.clave = pe.nombre and s.velocidad > 0
  join produccion.v_tiempos_efectivos te on te.entidad = 'envasado' and te.entidad_id = v.id
  where v.estado = 'activo' and te.min_efectivos > v.cantidad / s.velocidad
  on conflict (tipo, entidad_id) do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- Fabricación lista para envasar sin ningún envasado cargado
  insert into produccion.alertas (tipo, entidad, entidad_id, texto)
  select 'falta_envasado', 'fabricacion', f.id,
         format('Falta cargar el envasado de %s — tanque %s, listo para envasar.', p.nombre, t.codigo)
  from produccion.fabricaciones f
  join produccion.productos p on p.id = f.producto_id
  join produccion.tanques t on t.id = f.tanque_id
  where f.estado = 'para_envasar'
    and not exists (select 1 from produccion.envasados v where v.fabricacion_id = f.id)
  on conflict (tipo, entidad_id) do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;

revoke execute on function produccion.revisar_alertas() from public, anon, authenticated;

alter publication supabase_realtime add table produccion.alertas;
