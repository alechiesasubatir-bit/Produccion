-- ProdControl · 014 — varias operarias por orden (participaciones), etiquetas y vencimiento
-- Secciones: 1. Esquema · 2. RPC · 3. Vistas · migración de datos al final.

-- 1. Esquema -----------------------------------------------------------------

create table produccion.participaciones (
  id                  uuid primary key default gen_random_uuid(),
  entidad             text not null check (entidad in ('fabricacion', 'envasado', 'fraccionado')),
  entidad_id          uuid not null,  -- sin FK, como eventos
  empleado_id         uuid not null references produccion.operarias (empleado_id),
  desde               timestamptz not null default now(),
  hasta               timestamptz,
  cantidad            numeric check (cantidad > 0),
  unidad              text check (unidad in ('L', 'kg')),
  cantidad_corregida  numeric check (cantidad_corregida > 0),
  corregida_por       uuid references auth.users (id) on delete set null,
  corregida_at        timestamptz
);
create unique index participaciones_abierta_uk
  on produccion.participaciones (entidad, entidad_id, empleado_id) where hasta is null;
create index participaciones_entidad_idx on produccion.participaciones (entidad, entidad_id);
create index participaciones_empleado_idx on produccion.participaciones (empleado_id);
create index participaciones_corregida_por_idx on produccion.participaciones (corregida_por);

alter table produccion.participaciones enable row level security;
grant select on produccion.participaciones to authenticated;
create policy participaciones_leer on produccion.participaciones for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));

-- Etiquetas (catálogo, como presentaciones)
create table produccion.etiquetas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table produccion.etiquetas enable row level security;
grant select, insert, update, delete on produccion.etiquetas to authenticated;
create policy etiquetas_leer on produccion.etiquetas for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));
create policy etiquetas_crear on produccion.etiquetas for insert to authenticated
  with check ((select produccion.es_panel()));
create policy etiquetas_editar on produccion.etiquetas for update to authenticated
  using ((select produccion.es_panel())) with check ((select produccion.es_panel()));
create policy etiquetas_borrar on produccion.etiquetas for delete to authenticated
  using ((select produccion.es_panel()));

alter table produccion.envasados add column etiqueta_id uuid references produccion.etiquetas (id);
alter table produccion.fraccionados add column etiqueta_id uuid references produccion.etiquetas (id);
create index envasados_etiqueta_idx on produccion.envasados (etiqueta_id);
create index fraccionados_etiqueta_idx on produccion.fraccionados (etiqueta_id);

grant insert (etiqueta_id), update (etiqueta_id) on produccion.envasados to authenticated;
grant insert (etiqueta_id), update (etiqueta_id) on produccion.fraccionados to authenticated;

-- No se puede asignar una etiqueta desactivada (la que ya tenía la orden se conserva).
create function produccion._validar_etiqueta() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.etiqueta_id is not null
     and (tg_op = 'INSERT' or new.etiqueta_id is distinct from old.etiqueta_id)
     and not exists (select 1 from produccion.etiquetas e where e.id = new.etiqueta_id and e.activo) then
    raise exception using errcode = 'PC001', message = 'ETIQUETA_INACTIVA';
  end if;
  return new;
end $$;
revoke execute on function produccion._validar_etiqueta() from public, anon, authenticated;

create trigger envasados_validar_etiqueta before insert or update of etiqueta_id on produccion.envasados
  for each row execute function produccion._validar_etiqueta();
create trigger fraccionados_validar_etiqueta before insert or update of etiqueta_id on produccion.fraccionados
  for each row execute function produccion._validar_etiqueta();

-- Eventos nuevos
alter table produccion.eventos drop constraint eventos_accion_check;
alter table produccion.eventos add constraint eventos_accion_check
  check (accion in ('crear', 'iniciar', 'pausar', 'reanudar', 'finalizar', 'cancelar', 'editar',
                    'sumarse', 'salir', 'corregir'));

alter publication supabase_realtime add table produccion.participaciones, produccion.etiquetas;

-- Helper interno: abre una participación si la operaria no tiene una abierta en la orden.
create function produccion._abrir_participacion(p_entidad text, p_id uuid, p_empleado uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_empleado is null then return; end if;
  insert into produccion.participaciones (entidad, entidad_id, empleado_id)
  values (p_entidad, p_id, p_empleado)
  on conflict (entidad, entidad_id, empleado_id) where hasta is null do nothing;
end $$;
revoke execute on function produccion._abrir_participacion(text, uuid, uuid) from public, anon, authenticated;

-- Migración de datos: órdenes en curso con operaria → participación abierta desde el inicio.
-- Idempotente (no duplica si ya hay una abierta).
create function produccion._migrar_participaciones() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select 'fabricacion' as entidad, id, operaria_id as empleado_id, inicio
      from produccion.fabricaciones where estado in ('fabricando', 'pausada') and operaria_id is not null
    union all
    select 'envasado', id, operaria_1, inicio
      from produccion.envasados where estado in ('activo', 'pausado') and operaria_1 is not null
    union all
    select 'envasado', id, operaria_2, inicio
      from produccion.envasados where estado in ('activo', 'pausado') and operaria_2 is not null
    union all
    select 'fraccionado', id, operaria_id, inicio
      from produccion.fraccionados where estado in ('activo', 'pausado') and operaria_id is not null
  loop
    insert into produccion.participaciones (entidad, entidad_id, empleado_id, desde)
    values (r.entidad, r.id, r.empleado_id, coalesce(r.inicio, now()))
    on conflict (entidad, entidad_id, empleado_id) where hasta is null do nothing;
  end loop;
end $$;
revoke execute on function produccion._migrar_participaciones() from public, anon, authenticated;

-- 2. RPC ---------------------------------------------------------------------

-- cargar_mp: desde planta carga cualquier operaria con participación abierta en la fabricación
-- (o cualquiera activa si no hay ninguna abierta). cargado_por = quien carga.
create or replace function produccion.cargar_mp(
  p_mp_id uuid,
  p_lote text,
  p_pesado boolean,
  p_empleado_id uuid default null,
  p_pin text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_panel  boolean := produccion.es_panel();
  v_planta boolean := produccion.es_planta();
  v_fab    record;
begin
  -- 1. Rol
  if not (v_panel or v_planta) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  -- 2. Dispositivo de planta: operaria activa (idéntico a accion(); sin PIN desde 013)
  if not v_panel then
    if p_empleado_id is null then
      return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
    end if;
    if not exists (
      select 1 from produccion.operarias o
      join core.funcionarios f on f.id = o.empleado_id
      where o.empleado_id = p_empleado_id and o.activo and f.estado <> 'baja'
    ) then
      return jsonb_build_object('ok', false, 'codigo', 'OPERARIA_INACTIVA', 'detalle', null);
    end if;
  end if;

  -- 3. Fabricación de la MP (bloqueada: serializa con accion())
  select f.id, f.estado, f.operaria_id into v_fab
  from produccion.fabricacion_mp m
  join produccion.fabricaciones f on f.id = m.fabricacion_id
  where m.id = p_mp_id
  for update of f;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'NO_ENCONTRADO', 'detalle', null);
  end if;
  if v_fab.estado not in ('fabricando', 'pausada') then
    return jsonb_build_object('ok', false, 'codigo', 'TRANSICION_INVALIDA',
      'detalle', format('está en estado %s', replace(v_fab.estado, '_', ' ')));
  end if;
  -- sin participaciones abiertas (migrada sin operaria o iniciada desde el panel) carga cualquier operaria activa
  if not v_panel
     and exists (select 1 from produccion.participaciones pa
                 where pa.entidad = 'fabricacion' and pa.entidad_id = v_fab.id and pa.hasta is null)
     and not exists (select 1 from produccion.participaciones pa
                     where pa.entidad = 'fabricacion' and pa.entidad_id = v_fab.id and pa.hasta is null
                       and pa.empleado_id = p_empleado_id) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_PARTICIPA', 'detalle', null);
  end if;

  -- 4. Guardar
  update produccion.fabricacion_mp set
    lote        = nullif(trim(p_lote), ''),
    pesado      = coalesce(p_pesado, false),
    cargado_por = coalesce(p_empleado_id, v_fab.operaria_id),
    cargado_at  = now()
  where id = p_mp_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- accion(): suma sumarse/salir y las cantidades por operaria (p_cantidades). Cambia la firma.
drop function produccion.accion(text, uuid, text, uuid, text);

create function produccion.accion(
  p_entidad text,
  p_id uuid,
  p_accion text,
  p_empleado_id uuid default null,
  p_pin text default null,          -- ignorado desde 013
  p_cantidades jsonb default null   -- [{empleado_id, cantidad, unidad}] en salir/finalizar
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_panel     boolean := produccion.es_panel();
  v_planta    boolean := produccion.es_planta();
  v_estado    text;
  v_nuevo     text;
  v_fab_id    uuid;
  v_op        uuid;
  v_emp       uuid;
  v_fila      jsonb;
  v_cerrada   boolean := false;
  v_disp      text;
  v_det       text;
  v_msg       text;
  v_mp        int;
  v_abiertas  int;
  v_participa boolean;
  v_cant      numeric;
  v_uni       text;
  v_item      jsonb;
  v_lista     jsonb := '[]';
  v_datos     jsonb;
  v_p         record;
  v_fab       record;
  v_ev        record;
begin
  if p_entidad is null or p_entidad not in ('fabricacion', 'envasado', 'fraccionado')
     or p_accion is null
     or p_accion not in ('iniciar', 'sumarse', 'salir', 'pausar', 'reanudar', 'finalizar', 'cancelar') then
    raise exception using errcode = '22023', message = 'ACCION_DESCONOCIDA',
      detail = format('%s/%s', p_entidad, p_accion);
  end if;

  -- 1. Rol
  if not (v_panel or v_planta) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;
  if p_accion in ('sumarse', 'salir') and p_empleado_id is null then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  -- 2. Operaria activa: siempre desde planta (sin PIN desde 013); desde el panel, al sumar a alguien
  if not v_panel and (p_empleado_id is null or p_accion = 'cancelar') then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;
  if (not v_panel or p_accion = 'sumarse') and not exists (
    select 1 from produccion.operarias o
    join core.funcionarios f on f.id = o.empleado_id
    where o.empleado_id = p_empleado_id and o.activo and f.estado <> 'baja'
  ) then
    return jsonb_build_object('ok', false, 'codigo', 'OPERARIA_INACTIVA', 'detalle', null);
  end if;
  if not v_panel then
    select email into v_disp from public.perfiles where id = auth.uid();
  end if;

  -- 3..10. Negocio, atómico (errores con SQLSTATE PC001 → respuesta {ok:false})
  begin
    -- 3. Bloquear la orden (serializa todo lo que sigue: transición y participaciones)
    if p_entidad = 'fabricacion' then
      select estado, id, operaria_id into v_estado, v_fab_id, v_op
      from produccion.fabricaciones where id = p_id for update;
    elsif p_entidad = 'envasado' then
      select estado, fabricacion_id, operaria_1 into v_estado, v_fab_id, v_op
      from produccion.envasados where id = p_id for update;
    else
      select estado, operaria_id into v_estado, v_op
      from produccion.fraccionados where id = p_id for update;
    end if;
    if not found then
      raise exception using errcode = 'PC001', message = 'NO_ENCONTRADO';
    end if;

    -- 4. Transición (sumarse/salir no cambian el estado)
    if p_entidad = 'fabricacion' then
      v_nuevo := case
        when p_accion = 'iniciar'   and v_estado = 'cola'       then 'fabricando'
        when p_accion in ('sumarse', 'salir') and v_estado in ('fabricando', 'pausada') then v_estado
        when p_accion = 'pausar'    and v_estado = 'fabricando' then 'pausada'
        when p_accion = 'reanudar'  and v_estado = 'pausada'    then 'fabricando'
        when p_accion = 'finalizar' and v_estado = 'fabricando' then 'para_envasar'
        -- cierre manual con merma: solo la encargada
        when p_accion = 'finalizar' and v_estado = 'para_envasar' and v_panel then 'finalizada'
        when p_accion = 'cancelar'  and v_estado in ('cola', 'fabricando', 'pausada') then 'cancelada'
      end;
    else
      v_nuevo := case
        when p_accion = 'iniciar'   and v_estado = 'cola'    then 'activo'
        when p_accion in ('sumarse', 'salir') and v_estado in ('activo', 'pausado') then v_estado
        when p_accion = 'pausar'    and v_estado = 'activo'  then 'pausado'
        when p_accion = 'reanudar'  and v_estado = 'pausado' then 'activo'
        when p_accion = 'finalizar' and v_estado = 'activo'  then 'finalizado'
        when p_accion = 'cancelar'  and v_estado in ('cola', 'activo', 'pausado') then 'cancelado'
      end;
    end if;

    if v_nuevo is null then
      -- último cambio de estado (sumarse/salir/editar no cuentan)
      select e.accion, e.at, coalesce(f.nombre, p.nombre, 'la encargada') as quien into v_ev
      from produccion.eventos e
      left join core.funcionarios f on f.id = e.empleado_id
      left join public.perfiles p on p.id = e.usuario_id
      where e.entidad = p_entidad and e.entidad_id = p_id
        and e.accion in ('iniciar', 'pausar', 'reanudar', 'finalizar', 'cancelar')
      order by e.at desc, e.id desc
      limit 1;

      if found then
        v_det := format('ya la %s %s a las %s',
          case v_ev.accion
            when 'iniciar' then 'inició' when 'pausar' then 'pausó' when 'reanudar' then 'reanudó'
            when 'finalizar' then 'finalizó' else 'canceló' end,
          v_ev.quien,
          to_char(v_ev.at at time zone 'America/Montevideo', 'HH24:MI'));
      else
        v_det := format('está en estado %s', replace(v_estado, '_', ' '));
      end if;
      raise exception using errcode = 'PC001', message = 'TRANSICION_INVALIDA', detail = v_det;
    end if;

    -- 4b. Fórmula: no se finaliza la fabricación con materias primas sin lote o sin pesar
    if p_entidad = 'fabricacion' and p_accion = 'finalizar' and v_estado = 'fabricando' then
      select count(*) into v_mp
      from produccion.fabricacion_mp m
      where m.fabricacion_id = p_id and (nullif(trim(m.lote), '') is null or not m.pesado);
      if v_mp > 0 then
        raise exception using errcode = 'PC001', message = 'MP_INCOMPLETA', detail = v_mp::text;
      end if;
    end if;

    -- 5. Participación
    select count(*), coalesce(bool_or(pa.empleado_id = p_empleado_id), false)
      into v_abiertas, v_participa
    from produccion.participaciones pa
    where pa.entidad = p_entidad and pa.entidad_id = p_id and pa.hasta is null;

    if p_accion = 'sumarse' and v_participa then
      raise exception using errcode = 'PC001', message = 'YA_PARTICIPA';
    end if;
    if p_accion = 'salir' then
      if not v_participa then
        raise exception using errcode = 'PC001', message = 'NO_PARTICIPA';
      end if;
      if v_abiertas = 1 then
        raise exception using errcode = 'PC001', message = 'ULTIMA_OPERARIA';
      end if;
    end if;
    -- planta: solo quien está en la orden la pausa/reanuda/finaliza; si no hay nadie, entra quien acciona
    if not v_panel and p_accion in ('pausar', 'reanudar', 'finalizar') then
      if v_abiertas > 0 and not v_participa then
        raise exception using errcode = 'PC001', message = 'NO_PARTICIPA';
      end if;
      if v_abiertas = 0 then
        perform produccion._abrir_participacion(p_entidad, p_id, p_empleado_id);
        v_abiertas := 1;
      end if;
    end if;

    -- 6. Reglas de envasado
    if p_entidad = 'envasado' and p_accion = 'iniciar' then
      if (select estado from produccion.fabricaciones where id = v_fab_id) <> 'para_envasar' then
        raise exception using errcode = 'PC001', message = 'TANQUE_NO_LISTO';
      end if;
    end if;
    -- una operaria en un solo envasado activo a la vez (los pausados no bloquean, como en 013).
    -- iniciar/sumarse: quien entra. reanudar: todas las que siguen abiertas en la orden (incluida
    -- quien acciona; si no hay ninguna abierta, la asignada de legado). Locks por operaria en orden
    -- de empleado_id para no generar deadlocks entre reanudaciones simultáneas.
    if p_entidad = 'envasado' and p_accion in ('iniciar', 'sumarse', 'reanudar') then
      for v_emp in
        select x.empleado_id from (
          select coalesce(p_empleado_id, v_op) as empleado_id where p_accion in ('iniciar', 'sumarse')
          union
          select pa.empleado_id from produccion.participaciones pa
          where p_accion = 'reanudar' and pa.entidad = 'envasado' and pa.entidad_id = p_id and pa.hasta is null
          union
          select p_empleado_id where p_accion = 'reanudar'
          union
          select v_op where p_accion = 'reanudar' and v_abiertas = 0
        ) x
        where x.empleado_id is not null
        order by x.empleado_id
      loop
        perform 1 from produccion.operarias where empleado_id = v_emp for update;
        select pr.nombre || ' ' || pe.nombre into v_det
        from produccion.envasados v
        join produccion.fabricaciones f on f.id = v.fabricacion_id
        join produccion.productos pr on pr.id = f.producto_id
        join produccion.presentaciones pe on pe.id = v.presentacion_id
        where v.id <> p_id and v.estado = 'activo'
          and (
            -- participación abierta en otro envasado activo
            exists (
              select 1 from produccion.participaciones pa
              where pa.entidad = 'envasado' and pa.entidad_id = v.id and pa.empleado_id = v_emp and pa.hasta is null)
            -- legado: envasado activo sin participaciones, con la operaria en operaria_1/operaria_2
            or (v_emp in (v.operaria_1, v.operaria_2) and not exists (
              select 1 from produccion.participaciones pa
              where pa.entidad = 'envasado' and pa.entidad_id = v.id and pa.hasta is null))
          )
        limit 1;
        if found then
          raise exception using errcode = 'PC001', message = 'OPERARIA_OCUPADA', detail = v_det;
        end if;
      end loop;
    end if;

    -- 7. Efectos en la orden
    if p_accion in ('sumarse', 'salir') then
      if p_entidad = 'fabricacion' then
        select to_jsonb(t.*) into v_fila from produccion.fabricaciones t where t.id = p_id;
      elsif p_entidad = 'envasado' then
        select to_jsonb(t.*) into v_fila from produccion.envasados t where t.id = p_id;
      else
        select to_jsonb(t.*) into v_fila from produccion.fraccionados t where t.id = p_id;
      end if;
    elsif p_entidad = 'fabricacion' then
      update produccion.fabricaciones t set
        estado      = v_nuevo,
        inicio      = case when p_accion = 'iniciar' then coalesce(t.inicio, now()) else t.inicio end,
        operaria_id = case when p_accion = 'iniciar' then coalesce(t.operaria_id, p_empleado_id) else t.operaria_id end,
        fin         = case when p_accion in ('finalizar', 'cancelar') then now() else t.fin end
      where t.id = p_id
      returning to_jsonb(t.*) into v_fila;
    elsif p_entidad = 'envasado' then
      update produccion.envasados t set
        estado     = v_nuevo,
        inicio     = case when p_accion = 'iniciar' then coalesce(t.inicio, now()) else t.inicio end,
        operaria_1 = case when p_accion = 'iniciar' then coalesce(t.operaria_1, p_empleado_id) else t.operaria_1 end,
        fin        = case when p_accion in ('finalizar', 'cancelar') then now() else t.fin end
      where t.id = p_id
      returning to_jsonb(t.*) into v_fila;
    else
      update produccion.fraccionados t set
        estado      = v_nuevo,
        inicio      = case when p_accion = 'iniciar' then coalesce(t.inicio, now()) else t.inicio end,
        operaria_id = case when p_accion = 'iniciar' then coalesce(t.operaria_id, p_empleado_id) else t.operaria_id end,
        fin         = case when p_accion in ('finalizar', 'cancelar') then now() else t.fin end
      where t.id = p_id
      returning to_jsonb(t.*) into v_fila;
    end if;

    -- 8. Participaciones
    if p_accion = 'iniciar' then
      -- quien inicia; desde el panel sin operaria, la asignada a la orden (si tiene)
      perform produccion._abrir_participacion(p_entidad, p_id, coalesce(p_empleado_id, v_op));
    elsif p_accion = 'sumarse' then
      insert into produccion.participaciones (entidad, entidad_id, empleado_id)
      values (p_entidad, p_id, p_empleado_id);
    elsif p_accion in ('salir', 'finalizar', 'cancelar') then
      if p_cantidades is not null and jsonb_typeof(p_cantidades) <> 'array' then
        raise exception using errcode = 'PC001', message = 'CANTIDAD_REQUERIDA';
      end if;
      for v_p in
        select pa.id, pa.empleado_id from produccion.participaciones pa
        where pa.entidad = p_entidad and pa.entidad_id = p_id and pa.hasta is null
          and (p_accion <> 'salir' or pa.empleado_id = p_empleado_id)
        order by pa.desde, pa.id
        for update
      loop
        v_cant := null;
        v_uni  := null;
        -- cantidades: envasado/fraccionado al salir o finalizar; obligatorias solo desde planta
        if p_entidad <> 'fabricacion' and p_accion <> 'cancelar' then
          v_item := null;
          select e.value into v_item
          from jsonb_array_elements(coalesce(p_cantidades, '[]'::jsonb)) e
          where e.value->>'empleado_id' = v_p.empleado_id::text
          limit 1;
          if v_item is null then
            if not v_panel then
              raise exception using errcode = 'PC001', message = 'CANTIDAD_REQUERIDA';
            end if;
          elsif not (case when jsonb_typeof(v_item->'cantidad') = 'number'
                          then (v_item->>'cantidad')::numeric > 0 else false end)
                or coalesce(v_item->>'unidad', '') not in ('L', 'kg') then
            raise exception using errcode = 'PC001', message = 'CANTIDAD_REQUERIDA';
          else
            v_cant  := (v_item->>'cantidad')::numeric;
            v_uni   := v_item->>'unidad';
            v_lista := v_lista || jsonb_build_array(
              jsonb_build_object('empleado_id', v_p.empleado_id, 'cantidad', v_cant, 'unidad', v_uni));
          end if;
        end if;
        update produccion.participaciones set hasta = now(), cantidad = v_cant, unidad = v_uni
        where id = v_p.id;
      end loop;
    end if;

    -- 9. Evento
    v_datos := case
      when p_accion = 'salir' then
        case when v_cant is null then '{}'::jsonb
             else jsonb_build_object('cantidad', v_cant, 'unidad', v_uni) end
      when p_accion = 'finalizar' and jsonb_array_length(v_lista) > 0 then
        jsonb_build_object('cantidades', v_lista)
    end;
    insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, dispositivo, datos)
    values (p_entidad, p_id, p_accion, p_empleado_id, auth.uid(), v_disp, coalesce(v_datos, '{}'::jsonb));

    -- 10. Cierre automático de la fabricación al terminar de envasar (cierra también sus participaciones)
    if p_entidad = 'envasado' and p_accion = 'finalizar' then
      select f.id, f.litros, f.estado into v_fab
      from produccion.fabricaciones f where f.id = v_fab_id for update;

      -- solo si no quedan otros envasados pendientes de esta fabricación (si no, quedarían huérfanos)
      if v_fab.estado = 'para_envasar'
         and not exists (
           select 1 from produccion.envasados o
           where o.fabricacion_id = v_fab.id and o.id <> p_id and o.estado in ('cola', 'activo', 'pausado')
         )
         and v_fab.litros - coalesce((
           select sum(v.cantidad * pe.litros_equiv)
           from produccion.envasados v
           join produccion.presentaciones pe on pe.id = v.presentacion_id
           where v.fabricacion_id = v_fab.id and v.estado = 'finalizado'
         ), 0) <= 0 then
        update produccion.fabricaciones set estado = 'finalizada', fin = now() where id = v_fab.id;
        update produccion.participaciones set hasta = now()
        where entidad = 'fabricacion' and entidad_id = v_fab.id and hasta is null;
        insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, dispositivo, datos)
        values ('fabricacion', v_fab.id, 'finalizar', p_empleado_id, auth.uid(), v_disp, '{"auto": true}');
        v_cerrada := true;
      end if;
    end if;

    return v_fila || jsonb_build_object('ok', true, 'fabricacion_cerrada', v_cerrada);
  exception when sqlstate 'PC001' then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    return jsonb_build_object('ok', false, 'codigo', v_msg, 'detalle', nullif(v_det, ''));
  end;
end;
$$;

revoke execute on function produccion.accion(text, uuid, text, uuid, text, jsonb) from public, anon;
grant execute on function produccion.accion(text, uuid, text, uuid, text, jsonb) to authenticated;

-- 3. Vistas ------------------------------------------------------------------

-- Migración de datos (siempre al final del archivo) ---------------------------
select produccion._migrar_participaciones();
