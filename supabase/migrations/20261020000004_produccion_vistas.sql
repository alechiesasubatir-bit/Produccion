-- ProdControl · 004 — vistas de estado de tanque y tiempos efectivos + realtime

-- Estado de cada tanque activo, derivado de su fabricación abierta (a lo sumo una, por índice único)
-- y, si está para_envasar, de sus envasados: activo > pausado > cola.
create view produccion.v_tanque_estado with (security_invoker = true) as
with abierta as (
  select f.*, p.nombre as producto, p.color,
    greatest(0, f.litros - coalesce((
      select sum(v.cantidad * pe.litros_equiv)
      from produccion.envasados v
      join produccion.presentaciones pe on pe.id = v.presentacion_id
      where v.fabricacion_id = f.id and v.estado = 'finalizado'
    ), 0)) as litros_restantes
  from produccion.fabricaciones f
  join produccion.productos p on p.id = f.producto_id
  where f.estado in ('cola', 'fabricando', 'pausada', 'para_envasar')
)
select
  t.id as tanque_id,
  t.codigo,
  t.capacidad_l,
  t.orden,
  case
    when a.id is null then 'libre'
    when a.estado <> 'para_envasar' then a.estado
    when e.estado = 'activo' then 'envasando'
    when e.estado = 'pausado' then 'env_pausado'
    when e.estado = 'cola' then 'cola_env'
    else 'para_envasar'
  end as estado,
  a.id as fabricacion_id,
  a.producto_id,
  a.producto,
  a.color,
  a.litros,
  a.litros_restantes,
  e.id as envasado_id,
  coalesce(e.operaria_1, a.operaria_id) as operaria_id,
  coalesce(e.inicio, a.inicio) as inicio
from produccion.tanques t
left join abierta a on a.tanque_id = t.id
left join lateral (
  select v.id, v.estado, v.operaria_1, v.inicio
  from produccion.envasados v
  where a.estado = 'para_envasar' and v.fabricacion_id = a.id
    and v.estado in ('activo', 'pausado', 'cola')
  order by case v.estado when 'activo' then 0 when 'pausado' then 1 else 2 end, v.created_at
  limit 1
) e on true
where t.activo;

-- Tiempos por tarea desde eventos. inicio = primer iniciar; fin = primer finalizar/cancelar
-- (en fabricaciones, el fin de la fase de fabricación, no el cierre automático al envasar).
-- Pausa = cada pausar hasta el reanudar siguiente; una pausa abierta cuenta hasta fin o now().
create view produccion.v_tiempos_efectivos with (security_invoker = true) as
with tarea as (
  select entidad, entidad_id,
    min(at) filter (where accion = 'iniciar') as inicio,
    min(at) filter (where accion in ('finalizar', 'cancelar')) as fin
  from produccion.eventos
  group by entidad, entidad_id
),
pausa as (
  select t.entidad, t.entidad_id,
    sum(extract(epoch from (
      least(coalesce(r.at, t.fin, now()), coalesce(t.fin, now())) - p.at
    )) / 60) as min_pausa
  from tarea t
  join produccion.eventos p
    on p.entidad = t.entidad and p.entidad_id = t.entidad_id and p.accion = 'pausar'
  left join lateral (
    select min(x.at) as at from produccion.eventos x
    where x.entidad = p.entidad and x.entidad_id = p.entidad_id
      and x.accion = 'reanudar' and x.at > p.at
  ) r on true
  group by t.entidad, t.entidad_id
)
select
  t.entidad,
  t.entidad_id,
  t.inicio,
  t.fin,
  extract(epoch from (coalesce(t.fin, now()) - t.inicio)) / 60 as min_brutos,
  coalesce(p.min_pausa, 0) as min_pausa,
  extract(epoch from (coalesce(t.fin, now()) - t.inicio)) / 60 - coalesce(p.min_pausa, 0) as min_efectivos
from tarea t
left join pausa p on p.entidad = t.entidad and p.entidad_id = t.entidad_id
where t.inicio is not null;

grant select on produccion.v_tanque_estado, produccion.v_tiempos_efectivos to authenticated;

-- Realtime (respeta RLS de quien se suscribe)
alter publication supabase_realtime add table
  produccion.fabricaciones, produccion.envasados, produccion.fraccionados;
