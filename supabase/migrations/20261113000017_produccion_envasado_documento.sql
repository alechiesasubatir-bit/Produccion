-- ProdControl · 017 — envasados y fraccionados desde el PDF de «Movimientos de Produccion»
-- Secciones: 1. Esquema · 2. RPC · 3. Vistas.

-- 1. Esquema -----------------------------------------------------------------

-- Envasado suelto: puede esperar fabricación (fabricacion_id null) pero siempre sabe qué granel necesita.
alter table produccion.envasados alter column fabricacion_id drop not null;
alter table produccion.envasados
  add column lote          text,
  add column codigo        text,
  add column descripcion   text,
  add column granel_id     uuid references produccion.productos (id),
  add column litros_granel numeric check (litros_granel > 0);
alter table produccion.envasados add constraint envasados_origen_ck
  check (fabricacion_id is not null or granel_id is not null);
create index envasados_granel_idx on produccion.envasados (granel_id);

alter table produccion.fraccionados add column codigo text;

-- Granel que ya estaba en el tanque sin pasar por la app
alter table produccion.fabricaciones
  add column origen text not null default 'formula' check (origen in ('formula', 'stock'));

-- Consumibles (envase, tapa, etiqueta…) de un envasado o fraccionado; escritura solo vía RPC.
create table produccion.consumibles (
  id          uuid primary key default gen_random_uuid(),
  entidad     text not null check (entidad in ('envasado', 'fraccionado')),
  entidad_id  uuid not null,
  orden       int not null,
  codigo      text not null,
  descripcion text not null,
  cantidad    numeric not null check (cantidad > 0),
  lote        text,
  cargado_por uuid references produccion.operarias (empleado_id),
  cargado_at  timestamptz,
  unique (entidad, entidad_id, orden)
);
create index consumibles_cargado_por_idx on produccion.consumibles (cargado_por);

alter table produccion.consumibles enable row level security;
grant select on produccion.consumibles to authenticated;
create policy consumibles_leer on produccion.consumibles for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));

alter publication supabase_realtime add table produccion.consumibles;

-- 2. RPC ---------------------------------------------------------------------

-- crear_granel_stock: solo panel. Tanque con granel que no se fabricó en la app: queda para_envasar.
create function produccion.crear_granel_stock(
  p_tanque_id uuid,
  p_producto_id uuid,
  p_litros numeric,
  p_lote text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cap    numeric;
  v_lote   text := nullif(trim(p_lote), '');
  v_id     uuid;
  v_constr text;
begin
  if not produccion.es_panel() then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  select t.capacidad_l into v_cap from produccion.tanques t where t.id = p_tanque_id;
  if v_cap is null
     or p_producto_id is null
     or not exists (select 1 from produccion.productos p where p.id = p_producto_id)
     or p_litros is null or p_litros <= 0 or p_litros > v_cap then
    return jsonb_build_object('ok', false, 'codigo', 'DATOS_INVALIDOS', 'detalle', null);
  end if;

  begin
    insert into produccion.fabricaciones (tanque_id, producto_id, litros, lote, estado, origen, inicio, fin)
    values (p_tanque_id, p_producto_id, p_litros, v_lote, 'para_envasar', 'stock', now(), now())
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constr = constraint_name;
    if v_constr = 'fabricaciones_tanque_abierta_uk' then
      return jsonb_build_object('ok', false, 'codigo', 'TANQUE_OCUPADO', 'detalle', null);
    end if;
    raise;
  end;

  -- el evento «crear» lo registra el trigger de fabricaciones
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke execute on function produccion.crear_granel_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function produccion.crear_granel_stock(uuid, uuid, numeric, text) to authenticated;

-- accion(): como en 015, más SIN_TANQUE (envasado sin fabricación no se inicia) y sin cierre automático si no hay fabricación.
-- accion(): finalizar una fabricación la deja en_control (antes para_envasar); cancelar vale en en_control.
create or replace function produccion.accion(
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
    -- 3b. Un envasado que espera fabricación no se inicia ni admite operarias
    if p_entidad = 'envasado' and p_accion in ('iniciar', 'sumarse') and v_fab_id is null then
      raise exception using errcode = 'PC001', message = 'SIN_TANQUE';
    end if;

    -- 4. Transición (sumarse/salir no cambian el estado)
    if p_entidad = 'fabricacion' then
      v_nuevo := case
        when p_accion = 'iniciar'   and v_estado = 'cola'       then 'fabricando'
        when p_accion in ('sumarse', 'salir') and v_estado in ('fabricando', 'pausada') then v_estado
        when p_accion = 'pausar'    and v_estado = 'fabricando' then 'pausada'
        when p_accion = 'reanudar'  and v_estado = 'pausada'    then 'fabricando'
        when p_accion = 'finalizar' and v_estado = 'fabricando' then 'en_control'
        -- cierre manual con merma: solo la encargada
        when p_accion = 'finalizar' and v_estado = 'para_envasar' and v_panel then 'finalizada'
        when p_accion = 'cancelar'  and v_estado in ('cola', 'fabricando', 'pausada', 'en_control') then 'cancelada'
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
    if p_entidad = 'envasado' and p_accion = 'finalizar' and v_fab_id is not null then
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

-- Consumibles de un documento: [{codigo, descripcion, cantidad}] con cantidad > 0 (vacío o null es válido).
create function produccion._consumibles_validos(p_cons jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_item jsonb;
begin
  if p_cons is null then return true; end if;
  if jsonb_typeof(p_cons) <> 'array' then return false; end if;
  for v_item in select e.value from jsonb_array_elements(p_cons) e loop
    if jsonb_typeof(v_item) <> 'object'
       or nullif(trim(v_item->>'codigo'), '') is null
       or nullif(trim(v_item->>'descripcion'), '') is null
       or jsonb_typeof(v_item->'cantidad') <> 'number'
       or (v_item->>'cantidad')::numeric <= 0 then
      return false;
    end if;
  end loop;
  return true;
end $$;
revoke execute on function produccion._consumibles_validos(jsonb) from public, anon, authenticated;

create function produccion._guardar_consumibles(p_entidad text, p_id uuid, p_cons jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into produccion.consumibles (entidad, entidad_id, orden, codigo, descripcion, cantidad)
  select p_entidad, p_id, c.ord::int, trim(c.value->>'codigo'), trim(c.value->>'descripcion'),
         (c.value->>'cantidad')::numeric
  from jsonb_array_elements(coalesce(p_cons, '[]'::jsonb)) with ordinality as c(value, ord);
end $$;
revoke execute on function produccion._guardar_consumibles(text, uuid, jsonb) from public, anon, authenticated;

-- crear_envasado_documento: solo panel. Envasado del PDF; con fabricacion_id null espera tanque.
-- Todo o nada: el bloque con handler deshace el envasado si algo falla.
create function produccion.crear_envasado_documento(p_env jsonb, p_consumibles jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_fab_id   uuid;
  v_granel   uuid;
  v_pres     uuid;
  v_etiq     uuid;
  v_cant     numeric;
  v_litros   numeric;
  v_fab      record;
  v_id       uuid;
  v_msg      text;
  v_det      text;
begin
  if not produccion.es_panel() then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  v_fab_id := nullif(p_env->>'fabricacion_id', '')::uuid;
  v_granel := nullif(p_env->>'granel_id', '')::uuid;
  v_pres   := nullif(p_env->>'presentacion_id', '')::uuid;
  v_etiq   := nullif(p_env->>'etiqueta_id', '')::uuid;
  v_cant   := nullif(p_env->>'cantidad', '')::numeric;
  v_litros := nullif(p_env->>'litros_granel', '')::numeric;

  if v_granel is null or v_pres is null
     or not exists (select 1 from produccion.productos p where p.id = v_granel)
     or not exists (select 1 from produccion.presentaciones pe where pe.id = v_pres)
     or v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant)
     or (v_litros is not null and v_litros <= 0)
     or not produccion._consumibles_validos(p_consumibles) then
    return jsonb_build_object('ok', false, 'codigo', 'DATOS_INVALIDOS', 'detalle', null);
  end if;

  begin
    if v_fab_id is not null then
      select f.estado, f.producto_id into v_fab
      from produccion.fabricaciones f where f.id = v_fab_id for update;
      if not found then
        raise exception using errcode = 'PC001', message = 'NO_ENCONTRADO';
      end if;
      if v_fab.estado not in ('cola', 'fabricando', 'pausada', 'en_control', 'para_envasar') then
        raise exception using errcode = 'PC001', message = 'TRANSICION_INVALIDA',
          detail = format('la fabricación está en estado %s', replace(v_fab.estado, '_', ' '));
      end if;
      if v_fab.producto_id <> v_granel then
        raise exception using errcode = 'PC001', message = 'GRANEL_DISTINTO';
      end if;
    end if;

    insert into produccion.envasados (fabricacion_id, granel_id, presentacion_id, cantidad, lote, codigo,
                                      descripcion, litros_granel, etiqueta_id)
    values (v_fab_id, v_granel, v_pres, v_cant::int, nullif(trim(p_env->>'lote'), ''),
            nullif(trim(p_env->>'codigo'), ''), nullif(trim(p_env->>'descripcion'), ''), v_litros, v_etiq)
    returning id into v_id;

    perform produccion._guardar_consumibles('envasado', v_id, p_consumibles);
    return jsonb_build_object('ok', true, 'id', v_id);
  exception when sqlstate 'PC001' then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    return jsonb_build_object('ok', false, 'codigo', v_msg, 'detalle', nullif(v_det, ''));
  end;
end;
$$;
revoke execute on function produccion.crear_envasado_documento(jsonb, jsonb) from public, anon;
grant execute on function produccion.crear_envasado_documento(jsonb, jsonb) to authenticated;

-- crear_fraccionado_documento: solo panel. Fraccionado de polvo del PDF; producto y presentación pueden faltar.
create function produccion.crear_fraccionado_documento(p_frac jsonb, p_consumibles jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prod   uuid;
  v_pres   uuid;
  v_etiq   uuid;
  v_cant   numeric;
  v_id     uuid;
  v_msg    text;
  v_det    text;
begin
  if not produccion.es_panel() then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  v_prod := nullif(p_frac->>'producto_id', '')::uuid;
  v_pres := nullif(p_frac->>'presentacion_id', '')::uuid;
  v_etiq := nullif(p_frac->>'etiqueta_id', '')::uuid;
  v_cant := nullif(p_frac->>'cantidad', '')::numeric;

  if v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant)
     or (v_prod is not null and not exists (select 1 from produccion.productos p where p.id = v_prod))
     or (v_pres is not null and not exists (select 1 from produccion.presentaciones pe where pe.id = v_pres))
     or not produccion._consumibles_validos(p_consumibles) then
    return jsonb_build_object('ok', false, 'codigo', 'DATOS_INVALIDOS', 'detalle', null);
  end if;

  begin
    insert into produccion.fraccionados (tipo, descripcion, producto_id, presentacion_id, cantidad, lote, codigo,
                                         etiqueta_id)
    values ('polvo', nullif(trim(p_frac->>'descripcion'), ''), v_prod, v_pres, v_cant::int,
            nullif(trim(p_frac->>'lote'), ''), nullif(trim(p_frac->>'codigo'), ''), v_etiq)
    returning id into v_id;

    perform produccion._guardar_consumibles('fraccionado', v_id, p_consumibles);
    return jsonb_build_object('ok', true, 'id', v_id);
  exception when sqlstate 'PC001' then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    return jsonb_build_object('ok', false, 'codigo', v_msg, 'detalle', nullif(v_det, ''));
  end;
end;
$$;
revoke execute on function produccion.crear_fraccionado_documento(jsonb, jsonb) from public, anon;
grant execute on function produccion.crear_fraccionado_documento(jsonb, jsonb) to authenticated;

-- cargar_consumible: como cargar_mp. La tarea debe estar activa o pausada; lote vacío guarda null.
create function produccion.cargar_consumible(
  p_id uuid,
  p_lote text,
  p_empleado_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_panel  boolean := produccion.es_panel();
  v_planta boolean := produccion.es_planta();
  v_c      record;
  v_estado text;
  v_op     uuid;
begin
  -- 1. Rol
  if not (v_panel or v_planta) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  -- 2. Dispositivo de planta: operaria activa
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

  -- 3. Tarea del consumible (bloqueada: serializa con accion())
  select c.entidad, c.entidad_id into v_c from produccion.consumibles c where c.id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'NO_ENCONTRADO', 'detalle', null);
  end if;
  if v_c.entidad = 'envasado' then
    select e.estado, e.operaria_1 into v_estado, v_op
    from produccion.envasados e where e.id = v_c.entidad_id for update;
  else
    select x.estado, x.operaria_id into v_estado, v_op
    from produccion.fraccionados x where x.id = v_c.entidad_id for update;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'NO_ENCONTRADO', 'detalle', null);
  end if;
  if v_estado not in ('activo', 'pausado') then
    return jsonb_build_object('ok', false, 'codigo', 'TRANSICION_INVALIDA',
      'detalle', format('está en estado %s', replace(v_estado, '_', ' ')));
  end if;
  -- sin participaciones abiertas carga cualquier operaria activa
  if not v_panel
     and exists (select 1 from produccion.participaciones pa
                 where pa.entidad = v_c.entidad and pa.entidad_id = v_c.entidad_id and pa.hasta is null)
     and not exists (select 1 from produccion.participaciones pa
                     where pa.entidad = v_c.entidad and pa.entidad_id = v_c.entidad_id and pa.hasta is null
                       and pa.empleado_id = p_empleado_id) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_PARTICIPA', 'detalle', null);
  end if;

  -- 4. Guardar
  update produccion.consumibles set
    lote        = nullif(trim(p_lote), ''),
    cargado_por = case when nullif(trim(p_lote), '') is null then null else coalesce(p_empleado_id, v_op) end,
    cargado_at  = case when nullif(trim(p_lote), '') is null then null else now() end
  where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function produccion.cargar_consumible(uuid, text, uuid) from public, anon;
grant execute on function produccion.cargar_consumible(uuid, text, uuid) to authenticated;

-- Reglas de edición de un envasado: cantidad/presentación no se tocan cerrado; el tanque solo en cola,
-- a una fabricación abierta del mismo granel. Solo mira las columnas editables (accion() no lo dispara).
create function produccion._validar_edicion_envasado() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_dest       record;
  v_prod_viejo uuid;
begin
  if (new.cantidad is distinct from old.cantidad or new.presentacion_id is distinct from old.presentacion_id)
     and old.estado in ('finalizado', 'cancelado') then
    raise exception using errcode = 'PC001', message = 'NO_EDITABLE';
  end if;

  if new.fabricacion_id is distinct from old.fabricacion_id then
    if old.estado <> 'cola' then
      raise exception using errcode = 'PC001', message = 'TANQUE_EN_USO';
    end if;
    if new.fabricacion_id is null then
      raise exception using errcode = 'PC001', message = 'SIN_TANQUE';
    end if;
    select f.estado, f.producto_id into v_dest
    from produccion.fabricaciones f where f.id = new.fabricacion_id for share;
    if not found
       or v_dest.estado not in ('cola', 'fabricando', 'pausada', 'en_control', 'para_envasar') then
      raise exception using errcode = 'PC001', message = 'TRANSICION_INVALIDA';
    end if;
    select f.producto_id into v_prod_viejo from produccion.fabricaciones f where f.id = old.fabricacion_id;
    if v_dest.producto_id is distinct from coalesce(new.granel_id, v_prod_viejo) then
      raise exception using errcode = 'PC001', message = 'GRANEL_DISTINTO';
    end if;
  end if;
  return new;
end $$;
revoke execute on function produccion._validar_edicion_envasado() from public, anon, authenticated;

create trigger envasados_validar_edicion
  before update of cantidad, presentacion_id, fabricacion_id, granel_id on produccion.envasados
  for each row execute function produccion._validar_edicion_envasado();

-- Alta manual desde el panel: columnas nuevas
grant insert (granel_id, lote, codigo, descripcion), update (granel_id, lote, codigo, descripcion)
  on produccion.envasados to authenticated;
grant insert (codigo), update (codigo) on produccion.fraccionados to authenticated;

-- 3. Vistas ------------------------------------------------------------------

-- Velocidades estándar: el granel de stock no se fabricó en la app, no mide tiempos de fabricación.
create or replace view produccion.v_tiempos_estandar with (security_invoker = true) as
select
  'fabricacion'::text as entidad, p.nombre as clave,
  avg(f.litros / te.min_efectivos) as velocidad,
  count(*)::int as muestras,
  max(p.litros_hora_std) as litros_hora_std
from produccion.fabricaciones f
join produccion.productos p on p.id = f.producto_id
join produccion.v_tiempos_efectivos te on te.entidad = 'fabricacion' and te.entidad_id = f.id
where f.estado = 'finalizada' and te.fin is not null and te.min_efectivos > 0.1
  and f.origen <> 'stock'
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

-- v_flujo: los envasados que esperan fabricación (sin tanque) también aparecen; el producto sale del
-- granel. Columnas nuevas solo al final: lote_doc (lote del documento), granel_id, origen (de la fabricación;
-- null en envasados y fraccionados).
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
  f.fin, null::uuid as fabricacion_id, r.litros_restantes, p.tipo as producto_tipo,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'fabricacion' and pa.entidad_id = f.id and pa.hasta is null) as operarias, null::text as etiqueta,
  ctl.control_intento, ctl.control_rechazo,
  null::text as lote_doc, null::uuid as granel_id, f.origen as origen
from produccion.fabricaciones f
join produccion.productos p on p.id = f.producto_id
join produccion.tanques t on t.id = f.tanque_id
join restantes r on r.id = f.id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fabricacion' and te.entidad_id = f.id
cross join lateral (
  select (count(*) + 1)::int as control_intento,
    case when f.estado in ('fabricando', 'pausada')
      and (select c2.resultado from produccion.controles c2 where c2.fabricacion_id = f.id order by c2.intento desc limit 1) = 'rechazado'
    then (select ev.datos->>'motivo' from produccion.eventos ev
          where ev.entidad = 'fabricacion' and ev.entidad_id = f.id and ev.accion = 'rechazar'
          order by ev.at desc, ev.id desc limit 1) end as control_rechazo
  from produccion.controles c where c.fabricacion_id = f.id
) ctl
where f.estado in ('cola', 'fabricando', 'pausada', 'en_control', 'para_envasar')
   or (f.estado = 'finalizada' and f.fin >= (select desde from hoy))
union all
select
  'envasado', v.id, v.estado,
  p.nombre, p.color, t.codigo,
  pe.nombre, v.cantidad, coalesce(f.litros, v.litros_granel), f.lote, v.descripcion,
  v.operaria_1, v.operaria_2,
  coalesce(f.estado = 'para_envasar', false), v.inicio, te.min_efectivos, v.estado = 'activo', v.created_at,
  v.fin, v.fabricacion_id, r.litros_restantes, p.tipo,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'envasado' and pa.entidad_id = v.id and pa.hasta is null), (select e.nombre from produccion.etiquetas e where e.id = v.etiqueta_id),
  null::int, null::text,
  v.lote, coalesce(v.granel_id, f.producto_id), null::text
from produccion.envasados v
left join produccion.fabricaciones f on f.id = v.fabricacion_id
left join produccion.productos p on p.id = coalesce(f.producto_id, v.granel_id)
left join produccion.tanques t on t.id = f.tanque_id
join produccion.presentaciones pe on pe.id = v.presentacion_id
left join restantes r on r.id = f.id
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
  x.fin, null::uuid, null::numeric, p.tipo,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'fraccionado' and pa.entidad_id = x.id and pa.hasta is null), (select e.nombre from produccion.etiquetas e where e.id = x.etiqueta_id),
  null::int, null::text,
  x.lote, null::uuid, null::text
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id
where x.estado in ('cola', 'activo', 'pausado')
   or (x.estado = 'finalizado' and x.fin >= (select desde from hoy));

-- v_tareas: el envasado sigue con join a la fabricación (sin tanque no es tarea de planta).
-- Al final: lote_doc y el avance de consumibles (total / con lote cargado).
create or replace view produccion.v_tareas with (security_invoker = true) as
select
  'fabricacion'::text as entidad, f.id, f.estado,
  p.nombre as producto, p.color, t.codigo as tanque_codigo,
  null::text as presentacion, null::int as cantidad, f.litros, f.lote, null::text as descripcion,
  f.operaria_id as operaria_1, null::uuid as operaria_2,
  true as listo, f.inicio, te.min_efectivos, f.estado = 'fabricando' as corriendo, f.created_at,
  mp.mp_total, mp.mp_completas, p.tipo as producto_tipo,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'fabricacion' and pa.entidad_id = f.id and pa.hasta is null) as operarias, null::text as etiqueta, f.vencimiento,
  ctl.control_intento, ctl.control_rechazo,
  null::text as lote_doc, 0 as consumibles_total, 0 as consumibles_con_lote
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
cross join lateral (
  select (count(*) + 1)::int as control_intento,
    case when f.estado in ('fabricando', 'pausada')
      and (select c2.resultado from produccion.controles c2 where c2.fabricacion_id = f.id order by c2.intento desc limit 1) = 'rechazado'
    then (select ev.datos->>'motivo' from produccion.eventos ev
          where ev.entidad = 'fabricacion' and ev.entidad_id = f.id and ev.accion = 'rechazar'
          order by ev.at desc, ev.id desc limit 1) end as control_rechazo
  from produccion.controles c where c.fabricacion_id = f.id
) ctl
where f.estado in ('cola', 'fabricando', 'pausada', 'en_control')
union all
select
  'envasado', v.id, v.estado,
  p.nombre, p.color, t.codigo,
  pe.nombre, v.cantidad, f.litros, f.lote, v.descripcion,
  v.operaria_1, v.operaria_2,
  f.estado = 'para_envasar', v.inicio, te.min_efectivos, v.estado = 'activo', v.created_at,
  0, 0, p.tipo,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'envasado' and pa.entidad_id = v.id and pa.hasta is null), (select e.nombre from produccion.etiquetas e where e.id = v.etiqueta_id), f.vencimiento,
  null::int, null::text,
  v.lote,
  (select count(*)::int from produccion.consumibles c where c.entidad = 'envasado' and c.entidad_id = v.id),
  (select count(*)::int from produccion.consumibles c where c.entidad = 'envasado' and c.entidad_id = v.id and c.lote is not null)
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
  0, 0, p.tipo,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'fraccionado' and pa.entidad_id = x.id and pa.hasta is null), (select e.nombre from produccion.etiquetas e where e.id = x.etiqueta_id), null::date,
  null::int, null::text,
  x.lote,
  (select count(*)::int from produccion.consumibles c where c.entidad = 'fraccionado' and c.entidad_id = x.id),
  (select count(*)::int from produccion.consumibles c where c.entidad = 'fraccionado' and c.entidad_id = x.id and c.lote is not null)
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id
where x.estado in ('cola', 'activo', 'pausado');

-- v_historial: envasados sin fabricación incluidos. Al final: lote_doc, consumibles (con quién cargó el
-- lote y cuándo) y origen de la fabricación (formula/stock; null en envasados y fraccionados).
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
  (coalesce(te.fin, f.fin, f.inicio, f.created_at) at time zone 'America/Montevideo')::date as dia,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde, 'hasta', pa.hasta,
      'cantidad', pa.cantidad, 'unidad', pa.unidad, 'cantidad_corregida', pa.cantidad_corregida,
      'minutos', round(produccion._minutos_participacion('fabricacion', f.id, pa.desde, pa.hasta), 1)) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'fabricacion' and pa.entidad_id = f.id) as participaciones, null::text as etiqueta,
  (select coalesce(jsonb_agg(jsonb_build_object('intento', c.intento, 'resultado', c.resultado, 'ph', c.ph, 'densidad', c.densidad,
      'perfume_ok', c.perfume_ok, 'perfume_comentario', c.perfume_comentario, 'visual_ok', c.visual_ok,
      'visual_comentario', c.visual_comentario, 'observaciones', c.observaciones, 'firmado_nombre', c.firmado_nombre,
      'origen', c.origen, 'created_at', c.created_at) order by c.intento), '[]'::jsonb)
    from produccion.controles c where c.fabricacion_id = f.id) as controles,
  null::text as lote_doc, '[]'::jsonb as consumibles, f.origen as origen
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
  f.lote, v.descripcion,
  v.operaria_1, n1.nombre, v.operaria_2, n2.nombre,
  v.inicio, v.fin, v.created_at,
  te.min_brutos, te.min_pausa, te.min_efectivos,
  (coalesce(v.fin, v.inicio, v.created_at) at time zone 'America/Montevideo')::date,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde, 'hasta', pa.hasta,
      'cantidad', pa.cantidad, 'unidad', pa.unidad, 'cantidad_corregida', pa.cantidad_corregida,
      'minutos', round(produccion._minutos_participacion('envasado', v.id, pa.desde, pa.hasta), 1)) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'envasado' and pa.entidad_id = v.id), (select e.nombre from produccion.etiquetas e where e.id = v.etiqueta_id),
  '[]'::jsonb,
  v.lote,
  (select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descripcion', c.descripcion, 'cantidad', c.cantidad,
      'lote', c.lote, 'cargado_nombre', cu.nombre, 'cargado_at', c.cargado_at) order by c.orden), '[]'::jsonb)
    from produccion.consumibles c left join core.funcionarios cu on cu.id = c.cargado_por
    where c.entidad = 'envasado' and c.entidad_id = v.id),
  null::text
from produccion.envasados v
left join produccion.fabricaciones f on f.id = v.fabricacion_id
left join produccion.productos p on p.id = coalesce(f.producto_id, v.granel_id)
left join produccion.tanques t on t.id = f.tanque_id
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
  (coalesce(x.fin, x.inicio, x.created_at) at time zone 'America/Montevideo')::date,
  (select coalesce(jsonb_agg(jsonb_build_object('empleado_id', pa.empleado_id, 'nombre', fu.nombre, 'desde', pa.desde, 'hasta', pa.hasta,
      'cantidad', pa.cantidad, 'unidad', pa.unidad, 'cantidad_corregida', pa.cantidad_corregida,
      'minutos', round(produccion._minutos_participacion('fraccionado', x.id, pa.desde, pa.hasta), 1)) order by pa.desde), '[]'::jsonb)
    from produccion.participaciones pa join core.funcionarios fu on fu.id = pa.empleado_id
    where pa.entidad = 'fraccionado' and pa.entidad_id = x.id), (select e.nombre from produccion.etiquetas e where e.id = x.etiqueta_id),
  '[]'::jsonb,
  x.lote,
  (select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descripcion', c.descripcion, 'cantidad', c.cantidad,
      'lote', c.lote, 'cargado_nombre', cu.nombre, 'cargado_at', c.cargado_at) order by c.orden), '[]'::jsonb)
    from produccion.consumibles c left join core.funcionarios cu on cu.id = c.cargado_por
    where c.entidad = 'fraccionado' and c.entidad_id = x.id),
  null::text
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join nombres n1 on n1.empleado_id = x.operaria_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id;
