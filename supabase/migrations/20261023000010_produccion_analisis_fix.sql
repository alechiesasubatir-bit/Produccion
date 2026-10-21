-- ProdControl · 010 — correcciones de la revisión del plan 4
-- 1) v_historial: el "fin" y el "día" de una fabricación son los de la fase de fabricación (primer
--    evento finalizar), no los que pisa el cierre automático al terminar de envasar.
-- 2) revisar_alertas(): borra las alertas cuya condición ya no se da (antes quedaban activas para siempre).

create or replace view produccion.v_historial with (security_invoker = true) as
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
  f.inicio, coalesce(te.fin, f.fin) as fin, f.created_at,
  te.min_brutos, te.min_pausa, te.min_efectivos,
  (coalesce(te.fin, f.fin, f.inicio, f.created_at) at time zone 'America/Montevideo')::date as dia
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

create or replace function produccion.revisar_alertas() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_total int := 0;
  v_n int;
begin
  -- Alertas resueltas: la condición ya no se da (la tarea terminó, se retomó la pausa, se cargó
  -- el envasado). Se borran; si el problema vuelve, se crea una alerta nueva.
  delete from produccion.alertas a
  where (a.tipo = 'exceso_9h' and a.entidad = 'fabricacion' and not exists (
           select 1 from produccion.fabricaciones f where f.id = a.entidad_id and f.estado in ('fabricando', 'pausada')))
     or (a.tipo = 'exceso_9h' and a.entidad = 'envasado' and not exists (
           select 1 from produccion.envasados v where v.id = a.entidad_id and v.estado in ('activo', 'pausado')))
     or (a.tipo = 'pausa_larga' and not exists (
           select 1 from produccion.envasados v where v.id = a.entidad_id and v.estado = 'pausado'))
     or (a.tipo = 'desvio_estandar' and not exists (
           select 1 from produccion.envasados v where v.id = a.entidad_id and v.estado in ('activo', 'pausado')))
     or (a.tipo = 'falta_envasado' and not exists (
           select 1 from produccion.fabricaciones f
           where f.id = a.entidad_id and f.estado = 'para_envasar'
             and not exists (select 1 from produccion.envasados v where v.fabricacion_id = f.id)));

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
