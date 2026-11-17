-- 019: menores del panel.
-- 1. fabricacion_mp a Realtime: el panel (tabla de MP y «Operarias» de la orden) ve al instante
--    lo que carga la tablet. Realtime respeta el RLS de quien se suscribe.
-- 2. v_nombres_operarias: nombre de toda operaria que alguna vez lo fue, aunque hoy esté inactiva o
--    dada de baja, para nombrar quién hizo algo en el pasado («Cargó», tramos, eventos). v_operarias
--    sigue mostrando solo las activas (es la lista de la tablet).

alter publication supabase_realtime add table produccion.fabricacion_mp;

create view produccion.v_nombres_operarias as
  select o.empleado_id, f.nombre
  from produccion.operarias o
  join core.funcionarios f on f.id = o.empleado_id;

grant select on produccion.v_nombres_operarias to authenticated;
