-- ProdControl · 007 — panel: eventos de alta/edición, v_flujo, administración de roles, realtime de catálogos

-- Eventos 'crear' y 'editar' -----------------------------------------------------
-- Los cambios de estado los registra accion(); acá solo altas y ediciones de datos.
create function produccion._registrar_evento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cambios jsonb;
begin
  if tg_op = 'INSERT' then
    insert into produccion.eventos (entidad, entidad_id, accion, usuario_id)
    values (tg_argv[0], new.id, 'crear', auth.uid());
  elsif old.estado = new.estado then
    select jsonb_object_agg(n.key, n.value) into v_cambios
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key);
    if v_cambios is not null then
      insert into produccion.eventos (entidad, entidad_id, accion, usuario_id, datos)
      values (tg_argv[0], new.id, 'editar', auth.uid(), v_cambios);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function produccion._registrar_evento() from public, anon, authenticated;

create trigger fabricaciones_eventos after insert or update on produccion.fabricaciones
  for each row execute function produccion._registrar_evento('fabricacion');
create trigger envasados_eventos after insert or update on produccion.envasados
  for each row execute function produccion._registrar_evento('envasado');
create trigger fraccionados_eventos after insert or update on produccion.fraccionados
  for each row execute function produccion._registrar_evento('fraccionado');

-- Flujo (kanban): tareas abiertas + terminadas hoy (America/Montevideo) -------------
create view produccion.v_flujo with (security_invoker = true) as
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
  f.fin, null::uuid as fabricacion_id, r.litros_restantes
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
  v.fin, v.fabricacion_id, r.litros_restantes
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
  x.fin, null::uuid, null::numeric
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id
where x.estado in ('cola', 'activo', 'pausado')
   or (x.estado = 'finalizado' and x.fin >= (select desde from hoy));

grant select on produccion.v_flujo to authenticated;

-- Roles de producción (la encargada no puede editar public.perfiles directamente) --
create function produccion.listar_usuarios()
returns table (id uuid, email text, nombre text, rol text, rol_produccion text, activo boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not produccion.es_panel() then
    raise exception using errcode = '42501', message = 'NO_AUTORIZADO';
  end if;
  return query
    select p.id, p.email, p.nombre, p.rol, p.rol_produccion, p.activo
    from public.perfiles p
    order by p.email;
end;
$$;

create function produccion.set_rol_usuario(p_usuario uuid, p_rol text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not produccion.es_panel() then
    raise exception using errcode = '42501', message = 'NO_AUTORIZADO';
  end if;
  if p_usuario = auth.uid() then
    raise exception using errcode = '42501', message = 'NO_PROPIO_ROL', detail = 'No podés cambiar tu propio rol.';
  end if;
  if p_rol is not null and p_rol not in ('panel', 'planta') then
    raise exception using errcode = '22023', message = 'ROL_INVALIDO';
  end if;
  update public.perfiles set rol_produccion = p_rol where id = p_usuario;
  if not found then
    raise exception using errcode = 'P0002', message = 'NO_ENCONTRADO';
  end if;
end;
$$;

revoke execute on function produccion.listar_usuarios(), produccion.set_rol_usuario(uuid, text) from public, anon;
grant execute on function produccion.listar_usuarios(), produccion.set_rol_usuario(uuid, text) to authenticated;

-- Realtime de catálogos (la pared y la tablet se enteran de tanques/productos/operarias nuevas)
alter publication supabase_realtime add table produccion.tanques, produccion.productos, produccion.operarias;
