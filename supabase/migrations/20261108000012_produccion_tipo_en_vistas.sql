-- ProdControl · 012 — tipo de producto (liquido/denso/polvo) en las vistas que dibujan tanques.
-- Las vistas quedan iguales y solo suman `producto_tipo` como última columna (create or replace lo permite).

create or replace view produccion.v_tanque_estado with (security_invoker = true) as
with abierta as (
  select f.*, p.nombre as producto, p.color, p.tipo as producto_tipo,
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
  coalesce(e.inicio, a.inicio) as inicio,
  a.producto_tipo
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

create or replace view produccion.v_flujo with (security_invoker = true) as
with hoy as (
  select (date_trunc('day', now() at time zone 'America/Montevideo') at time zone 'America/Montevideo') as desde
),
restantes as (
  select f.id, greatest(0, f.litros - coalesce((
    select sum(v.cantidad * pe.litros_equiv)
    from produccion.envasados v
    join produccion.presentaciones pe on pe.id = v.presentacion_id
    where v.fabricacion_id = f.id and v.estado = 'finalizado'
  ), 0)) as litros_restantes
  from produccion.fabricaciones f
)
select
  'fabricacion'::text as entidad, f.id, f.estado,
  p.nombre as producto, p.color, t.codigo as tanque_codigo,
  null::text as presentacion, null::int as cantidad, f.litros, f.lote, null::text as descripcion,
  f.operaria_id as operaria_1, null::uuid as operaria_2,
  true as listo, f.inicio, te.min_efectivos, f.estado = 'fabricando' as corriendo, f.created_at,
  f.fin, null::uuid as fabricacion_id, r.litros_restantes, p.tipo as producto_tipo
from produccion.fabricaciones f
join produccion.productos p on p.id = f.producto_id
join produccion.tanques t on t.id = f.tanque_id
join restantes r on r.id = f.id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fabricacion' and te.entidad_id = f.id
where f.estado in ('cola', 'fabricando', 'pausada', 'para_envasar')
   or (f.estado = 'finalizada' and f.fin >= (select desde from hoy))
union all
select
  'envasado', v.id, v.estado,
  p.nombre, p.color, t.codigo,
  pe.nombre, v.cantidad, f.litros, f.lote, null::text,
  v.operaria_1, v.operaria_2,
  f.estado = 'para_envasar', v.inicio, te.min_efectivos, v.estado = 'activo', v.created_at,
  v.fin, v.fabricacion_id, r.litros_restantes, p.tipo
from produccion.envasados v
join produccion.fabricaciones f on f.id = v.fabricacion_id
join produccion.productos p on p.id = f.producto_id
join produccion.tanques t on t.id = f.tanque_id
join produccion.presentaciones pe on pe.id = v.presentacion_id
join restantes r on r.id = f.id
left join produccion.v_tiempos_efectivos te on te.entidad = 'envasado' and te.entidad_id = v.id
where v.estado in ('cola', 'activo', 'pausado')
   or (v.estado = 'finalizado' and v.fin >= (select desde from hoy))
union all
select
  'fraccionado', x.id, x.estado,
  p.nombre, p.color, null::text,
  pe.nombre, x.cantidad, null::numeric, x.lote, x.descripcion,
  x.operaria_id, null::uuid,
  true, x.inicio, te.min_efectivos, x.estado = 'activo', x.created_at,
  x.fin, null::uuid, null::numeric, p.tipo
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id
where x.estado in ('cola', 'activo', 'pausado')
   or (x.estado = 'finalizado' and x.fin >= (select desde from hoy));

create or replace view produccion.v_tareas with (security_invoker = true) as
select
  'fabricacion'::text as entidad, f.id, f.estado,
  p.nombre as producto, p.color, t.codigo as tanque_codigo,
  null::text as presentacion, null::int as cantidad, f.litros, f.lote, null::text as descripcion,
  f.operaria_id as operaria_1, null::uuid as operaria_2,
  true as listo, f.inicio, te.min_efectivos, f.estado = 'fabricando' as corriendo, f.created_at,
  mp.mp_total, mp.mp_completas, p.tipo as producto_tipo
from produccion.fabricaciones f
join produccion.productos p on p.id = f.producto_id
join produccion.tanques t on t.id = f.tanque_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fabricacion' and te.entidad_id = f.id
cross join lateral (
  select count(*)::int as mp_total,
         (count(*) filter (where nullif(trim(m.lote), '') is not null and m.pesado))::int as mp_completas
  from produccion.fabricacion_mp m
  where m.fabricacion_id = f.id
) mp
where f.estado in ('cola', 'fabricando', 'pausada')
union all
select
  'envasado', v.id, v.estado,
  p.nombre, p.color, t.codigo,
  pe.nombre, v.cantidad, f.litros, f.lote, null::text,
  v.operaria_1, v.operaria_2,
  f.estado = 'para_envasar', v.inicio, te.min_efectivos, v.estado = 'activo', v.created_at,
  0, 0, p.tipo
from produccion.envasados v
join produccion.fabricaciones f on f.id = v.fabricacion_id
join produccion.productos p on p.id = f.producto_id
join produccion.tanques t on t.id = f.tanque_id
join produccion.presentaciones pe on pe.id = v.presentacion_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'envasado' and te.entidad_id = v.id
where v.estado in ('cola', 'activo', 'pausado')
union all
select
  'fraccionado', x.id, x.estado,
  p.nombre, p.color, null::text,
  pe.nombre, x.cantidad, null::numeric, x.lote, x.descripcion,
  x.operaria_id, null::uuid,
  true, x.inicio, te.min_efectivos, x.estado = 'activo', x.created_at,
  0, 0, p.tipo
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id
where x.estado in ('cola', 'activo', 'pausado');
