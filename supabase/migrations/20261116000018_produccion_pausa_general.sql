-- ProdControl · 018 — Pausa General y Arranque
-- Secciones: 1. Pausa general · 2. Arranque general y bloqueo de planta · 3. Alertas.

-- 1. Pausa general -----------------------------------------------------------

-- Una pausa general abierta (fin null) bloquea la planta hasta el Arranque. Escritura solo vía RPC.
create table produccion.pausas_generales (
  id             uuid primary key default gen_random_uuid(),
  inicio         timestamptz not null default now(),
  fin            timestamptz,
  iniciada_por   uuid not null references auth.users (id),
  terminada_por  uuid references auth.users (id) on delete set null
);
-- una sola pausa general abierta
create unique index pausas_generales_abierta_uk on produccion.pausas_generales ((true)) where fin is null;
create index pausas_generales_iniciada_por_idx on produccion.pausas_generales (iniciada_por);
create index pausas_generales_terminada_por_idx on produccion.pausas_generales (terminada_por);

alter table produccion.pausas_generales enable row level security;
grant select on produccion.pausas_generales to authenticated;
create policy pausas_generales_leer on produccion.pausas_generales for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));
alter publication supabase_realtime add table produccion.pausas_generales;

-- Órdenes que tomó cada pausa general: cómo estaban y quiénes trabajaban (para prellenar el Arranque).
create table produccion.pausa_general_ordenes (
  pausa_id    uuid not null references produccion.pausas_generales (id),
  entidad     text not null check (entidad in ('fabricacion', 'envasado', 'fraccionado')),
  entidad_id  uuid not null,  -- sin FK, como eventos
  estaba      text not null check (estaba in ('en_curso', 'pausada')),
  operarias   uuid[] not null default '{}',
  primary key (pausa_id, entidad, entidad_id)
);
alter table produccion.pausa_general_ordenes enable row level security;
grant select on produccion.pausa_general_ordenes to authenticated;
create policy pausa_general_ordenes_leer on produccion.pausa_general_ordenes for select to authenticated
  using ((select produccion.es_panel()));

-- Helper interno: la pausa general abierta (o null).
create function produccion._pausa_general_abierta() returns produccion.pausas_generales
language sql stable security definer set search_path = '' as $$
  select * from produccion.pausas_generales where fin is null;
$$;
revoke execute on function produccion._pausa_general_abierta() from public, anon, authenticated;

-- pausa_general: pausa todas las órdenes en marcha y saca a cada operaria con su cantidad.
-- p_cantidades = [{entidad, entidad_id, empleado_id, cantidad, unidad}] (envasado/fraccionado;
-- en fabricación se ignoran). Mismo contrato que accion(): errores de negocio como {ok:false}.
create function produccion.pausa_general(p_cantidades jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pausa   uuid;
  v_n       int := 0;
  v_o       record;
  v_p       record;
  v_ops     uuid[];
  v_item    jsonb;
  v_cant    numeric;
  v_uni     text;
  v_quien   text;
  v_orden   text;
  v_msg     text;
  v_det     text;
begin
  if not produccion.es_panel() then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  begin
    if p_cantidades is not null and jsonb_typeof(p_cantidades) <> 'array' then
      raise exception using errcode = 'PC001', message = 'CANTIDAD_REQUERIDA';
    end if;

    -- serializa pausa_general/arranque_general (dos pestañas a la vez); el índice único es la red
    lock table produccion.pausas_generales in share row exclusive mode;
    if (produccion._pausa_general_abierta()).id is not null then
      raise exception using errcode = 'PC001', message = 'PAUSA_GENERAL_ACTIVA';
    end if;

    insert into produccion.pausas_generales (iniciada_por) values (auth.uid())
    returning id into v_pausa;

    -- Órdenes en alcance, bloqueadas en orden fijo (entidad, id): envasado, fabricacion, fraccionado.
    -- Mismo sentido que accion() (envasado antes que su fabricación) para no generar deadlocks.
    for v_o in
      select 'envasado'::text as entidad, x.id, x.estado = 'activo' as en_curso
      from (select v.id, v.estado from produccion.envasados v
            where v.estado in ('activo', 'pausado') order by v.id for update) x
      union all
      select 'fabricacion', x.id, x.estado = 'fabricando'
      from (select f.id, f.estado from produccion.fabricaciones f
            where f.estado in ('fabricando', 'pausada') order by f.id for update) x
      union all
      select 'fraccionado', x.id, x.estado = 'activo'
      from (select r.id, r.estado from produccion.fraccionados r
            where r.estado in ('activo', 'pausado') order by r.id for update) x
    loop
      v_n := v_n + 1;

      -- 1. Registro de la orden con sus operarias abiertas
      select coalesce(array_agg(pa.empleado_id order by pa.empleado_id), '{}') into v_ops
      from produccion.participaciones pa
      where pa.entidad = v_o.entidad and pa.entidad_id = v_o.id and pa.hasta is null;

      insert into produccion.pausa_general_ordenes (pausa_id, entidad, entidad_id, estaba, operarias)
      values (v_pausa, v_o.entidad, v_o.id, case when v_o.en_curso then 'en_curso' else 'pausada' end, v_ops);

      -- 2. Pausar la que está en curso
      if v_o.en_curso then
        if v_o.entidad = 'envasado' then
          update produccion.envasados set estado = 'pausado' where id = v_o.id;
        elsif v_o.entidad = 'fabricacion' then
          update produccion.fabricaciones set estado = 'pausada' where id = v_o.id;
        else
          update produccion.fraccionados set estado = 'pausado' where id = v_o.id;
        end if;
        insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, datos)
        values (v_o.entidad, v_o.id, 'pausar', null, auth.uid(), jsonb_build_object('pausa_general', v_pausa));
      end if;

      -- 3-4. Cerrar cada participación abierta (envasado/fraccionado: con su cantidad, obligatoria)
      for v_p in
        select pa.id, pa.empleado_id from produccion.participaciones pa
        where pa.entidad = v_o.entidad and pa.entidad_id = v_o.id and pa.hasta is null
        order by pa.empleado_id
        for update
      loop
        v_cant := null;
        v_uni  := null;
        if v_o.entidad <> 'fabricacion' then
          v_item := null;
          select e.value into v_item
          from jsonb_array_elements(coalesce(p_cantidades, '[]'::jsonb)) e
          where e.value->>'entidad' = v_o.entidad
            and e.value->>'entidad_id' = v_o.id::text
            and e.value->>'empleado_id' = v_p.empleado_id::text
          limit 1;
          if v_item is null
             or not (case when jsonb_typeof(v_item->'cantidad') = 'number'
                          then (v_item->>'cantidad')::numeric > 0 else false end)
             or coalesce(v_item->>'unidad', '') not in ('L', 'kg') then
            select f.nombre into v_quien from core.funcionarios f where f.id = v_p.empleado_id;
            if v_o.entidad = 'envasado' then
              select concat_ws(' ', pr.nombre, pe.nombre) into v_orden
              from produccion.envasados v
              left join produccion.fabricaciones fa on fa.id = v.fabricacion_id
              left join produccion.productos pr on pr.id = coalesce(fa.producto_id, v.granel_id)
              left join produccion.presentaciones pe on pe.id = v.presentacion_id
              where v.id = v_o.id;
            else
              select concat_ws(' ', coalesce(pr.nombre, r.descripcion, r.tipo), pe.nombre) into v_orden
              from produccion.fraccionados r
              left join produccion.productos pr on pr.id = r.producto_id
              left join produccion.presentaciones pe on pe.id = r.presentacion_id
              where r.id = v_o.id;
            end if;
            raise exception using errcode = 'PC001', message = 'CANTIDAD_REQUERIDA',
              detail = format('%s en %s', v_quien, v_orden);
          end if;
          v_cant := (v_item->>'cantidad')::numeric;
          v_uni  := v_item->>'unidad';
        end if;

        update produccion.participaciones set hasta = now(), cantidad = v_cant, unidad = v_uni
        where id = v_p.id;
        insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, datos)
        values (v_o.entidad, v_o.id, 'salir', v_p.empleado_id, auth.uid(),
          jsonb_build_object('pausa_general', v_pausa)
          || case when v_cant is null then '{}'::jsonb
                  else jsonb_build_object('cantidad', v_cant, 'unidad', v_uni) end);
      end loop;
    end loop;

    if v_n = 0 then
      raise exception using errcode = 'PC001', message = 'SIN_ORDENES';
    end if;

    return jsonb_build_object('ok', true, 'pausa_id', v_pausa, 'ordenes', v_n);
  exception when sqlstate 'PC001' then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    return jsonb_build_object('ok', false, 'codigo', v_msg, 'detalle', nullif(v_det, ''));
  end;
end;
$$;
revoke execute on function produccion.pausa_general(jsonb) from public, anon;
grant execute on function produccion.pausa_general(jsonb) to authenticated;

-- 2. Arranque general y bloqueo de planta -------------------------------------

-- arranque_general: reanuda las órdenes elegidas con sus operarias y cierra la pausa general.
-- p_ordenes = [{entidad, entidad_id, empleados: [uuid]}]; lista vacía levanta la pausa sin reanudar.
-- Mismo contrato que accion(): errores de negocio como {ok:false}; todo o nada.
create function produccion.arranque_general(p_ordenes jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pausa    produccion.pausas_generales;
  v_lista    jsonb := coalesce(p_ordenes, '[]'::jsonb);
  v_ordenes  jsonb;
  v_n        int := 0;
  v_o        record;
  v_emp      uuid;
  v_estado   text;
  v_orden    text;
  v_vistas   text[] := '{}';
  v_ops_env  uuid[] := '{}';
  v_msg      text;
  v_det      text;
begin
  if not produccion.es_panel() then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;
  if jsonb_typeof(v_lista) <> 'array' then
    raise exception using errcode = '22023', message = 'ORDENES_INVALIDAS';
  end if;

  begin
    -- serializa con pausa_general (dos pestañas a la vez)
    lock table produccion.pausas_generales in share row exclusive mode;
    v_pausa := produccion._pausa_general_abierta();
    if v_pausa.id is null then
      raise exception using errcode = 'PC001', message = 'SIN_PAUSA_GENERAL';
    end if;

    -- Lista normalizada una sola vez, en el orden fijo de pausa_general (envasado, fabricacion,
    -- fraccionado; por id): [{entidad, entidad_id, empleados}] con empleados sin repetir.
    select coalesce(jsonb_agg(jsonb_build_object('entidad', x.entidad, 'entidad_id', x.entidad_id,
                                                 'empleados', to_jsonb(x.empleados))
                              order by case x.entidad when 'envasado' then 1 when 'fabricacion' then 2 else 3 end,
                                       x.entidad_id), '[]'::jsonb)
      into v_ordenes
    from (
      select e.value->>'entidad' as entidad,
             (e.value->>'entidad_id')::uuid as entidad_id,
             array(select distinct u.value::uuid
                   from jsonb_array_elements_text(case when jsonb_typeof(e.value->'empleados') = 'array'
                                                       then e.value->'empleados' else '[]'::jsonb end) u
                   where u.value is not null
                   order by 1) as empleados
      from jsonb_array_elements(v_lista) e
    ) x;

    -- 1. Validar y bloquear cada orden. Las operarias se bloquean después, como en accion().
    for v_o in
      select o.e->>'entidad' as entidad, (o.e->>'entidad_id')::uuid as entidad_id,
             array(select u.value::uuid from jsonb_array_elements_text(o.e->'empleados') u) as empleados
      from jsonb_array_elements(v_ordenes) with ordinality o(e, i)
      order by o.i
    loop
      if (v_o.entidad || ':' || v_o.entidad_id) = any(v_vistas) then
        raise exception using errcode = '22023', message = 'ORDEN_REPETIDA',
          detail = format('%s/%s', v_o.entidad, v_o.entidad_id);
      end if;
      v_vistas := v_vistas || (v_o.entidad || ':' || v_o.entidad_id);

      if not exists (
        select 1 from produccion.pausa_general_ordenes g
        where g.pausa_id = v_pausa.id and g.entidad = v_o.entidad and g.entidad_id = v_o.entidad_id
      ) then
        raise exception using errcode = 'PC001', message = 'NO_ENCONTRADO';
      end if;

      if v_o.entidad = 'fabricacion' then
        select f.estado, concat_ws(' ', pr.nombre, t.codigo) into v_estado, v_orden
        from produccion.fabricaciones f
        left join produccion.productos pr on pr.id = f.producto_id
        left join produccion.tanques t on t.id = f.tanque_id
        where f.id = v_o.entidad_id
        for update of f;
      elsif v_o.entidad = 'envasado' then
        select v.estado, concat_ws(' ', pr.nombre, pe.nombre) into v_estado, v_orden
        from produccion.envasados v
        left join produccion.fabricaciones fa on fa.id = v.fabricacion_id
        left join produccion.productos pr on pr.id = coalesce(fa.producto_id, v.granel_id)
        left join produccion.presentaciones pe on pe.id = v.presentacion_id
        where v.id = v_o.entidad_id
        for update of v;
      else
        select r.estado, concat_ws(' ', coalesce(pr.nombre, r.descripcion, r.tipo), pe.nombre)
          into v_estado, v_orden
        from produccion.fraccionados r
        left join produccion.productos pr on pr.id = r.producto_id
        left join produccion.presentaciones pe on pe.id = r.presentacion_id
        where r.id = v_o.entidad_id
        for update of r;
      end if;
      if not found then
        raise exception using errcode = 'PC001', message = 'NO_ENCONTRADO';
      end if;
      -- finalizada o cancelada por la encargada en la noche (o reanudada a mano)
      if v_estado not in ('pausada', 'pausado') then
        raise exception using errcode = 'PC001', message = 'TRANSICION_INVALIDA', detail = v_orden;
      end if;
      if cardinality(v_o.empleados) = 0 then
        raise exception using errcode = 'PC001', message = 'SIN_OPERARIAS', detail = v_orden;
      end if;
      if exists (
        select 1 from unnest(v_o.empleados) u(id)
        where not exists (
          select 1 from produccion.operarias o
          join core.funcionarios f on f.id = o.empleado_id
          where o.empleado_id = u.id and o.activo and f.estado <> 'baja')
      ) then
        raise exception using errcode = 'PC001', message = 'OPERARIA_INACTIVA';
      end if;
      -- envasado: las elegidas y las que la encargada sumó a mano en la noche (siguen abiertas)
      if v_o.entidad = 'envasado' then
        v_ops_env := v_ops_env || v_o.empleados || array(
          select pa.empleado_id from produccion.participaciones pa
          where pa.entidad = 'envasado' and pa.entidad_id = v_o.entidad_id and pa.hasta is null);
      end if;
    end loop;

    -- 2. Operarias de envasado bloqueadas en orden de empleado_id (como accion(), sin deadlocks)
    perform 1 from produccion.operarias o
    where o.empleado_id = any(v_ops_env)
    order by o.empleado_id
    for update;

    -- 3. Reanudar cada orden con sus operarias
    for v_o in
      select o.e->>'entidad' as entidad, (o.e->>'entidad_id')::uuid as entidad_id,
             array(select u.value::uuid from jsonb_array_elements_text(o.e->'empleados') u) as empleados
      from jsonb_array_elements(v_ordenes) with ordinality o(e, i)
      order by o.i
    loop
      -- una operaria en un solo envasado activo (misma regla y detalle que accion()). Como en
      -- accion(reanudar), se controlan las elegidas y las que ya tienen participación abierta (sumadas
      -- a mano en la noche). Los envasados de la lista ya reanudados cuentan como activos: E1 en dos
      -- de la lista choca con el anterior.
      if v_o.entidad = 'envasado' then
        for v_emp in
          select x.empleado_id from (
            select unnest(v_o.empleados) as empleado_id
            union
            select pa.empleado_id from produccion.participaciones pa
            where pa.entidad = 'envasado' and pa.entidad_id = v_o.entidad_id and pa.hasta is null
          ) x
          order by x.empleado_id
        loop
          select pr.nombre || ' ' || pe.nombre into v_det
          from produccion.envasados v
          join produccion.fabricaciones f on f.id = v.fabricacion_id
          join produccion.productos pr on pr.id = f.producto_id
          join produccion.presentaciones pe on pe.id = v.presentacion_id
          where v.id <> v_o.entidad_id and v.estado = 'activo'
            and (
              exists (
                select 1 from produccion.participaciones pa
                where pa.entidad = 'envasado' and pa.entidad_id = v.id and pa.empleado_id = v_emp and pa.hasta is null)
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

      if v_o.entidad = 'envasado' then
        update produccion.envasados set estado = 'activo' where id = v_o.entidad_id;
      elsif v_o.entidad = 'fabricacion' then
        update produccion.fabricaciones set estado = 'fabricando' where id = v_o.entidad_id;
      else
        update produccion.fraccionados set estado = 'activo' where id = v_o.entidad_id;
      end if;
      insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, datos)
      values (v_o.entidad, v_o.entidad_id, 'reanudar', null, auth.uid(),
        jsonb_build_object('pausa_general', v_pausa.id));

      foreach v_emp in array v_o.empleados loop
        -- la encargada pudo sumarla a mano en la noche: no se duplica la participación
        insert into produccion.participaciones (entidad, entidad_id, empleado_id)
        values (v_o.entidad, v_o.entidad_id, v_emp)
        on conflict (entidad, entidad_id, empleado_id) where hasta is null do nothing;
        if found then
          insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, datos)
          values (v_o.entidad, v_o.entidad_id, 'sumarse', v_emp, auth.uid(),
            jsonb_build_object('pausa_general', v_pausa.id));
        end if;
      end loop;

      v_n := v_n + 1;
    end loop;

    -- 4. Cerrar la pausa (las órdenes que no vinieron quedan pausadas)
    update produccion.pausas_generales set fin = now(), terminada_por = auth.uid()
    where id = v_pausa.id;

    return jsonb_build_object('ok', true, 'reanudadas', v_n);
  exception when sqlstate 'PC001' then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    return jsonb_build_object('ok', false, 'codigo', v_msg, 'detalle', nullif(v_det, ''));
  end;
end;
$$;
revoke execute on function produccion.arranque_general(jsonb) from public, anon;
grant execute on function produccion.arranque_general(jsonb) to authenticated;

-- Bloqueo de planta: con una pausa general abierta, accion(), cargar_mp() y cargar_consumible()
-- devuelven PAUSA_GENERAL desde planta (detalle = hora de inicio, HH24:MI Montevideo) antes de
-- cualquier otra regla. El panel no se bloquea. registrar_control() no cambia.

-- accion(): como en 017, más el bloqueo por pausa general.
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
  v_pausa_ini timestamptz;
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
  -- 1b. Pausa general: la planta queda bloqueada hasta el Arranque (el panel no). El lock (hasta el
  -- fin de la transacción) choca con el de pausa_general/arranque_general y no entre llamadas de
  -- planta: si la pausa está en curso se espera y se la ve; si no, la pausa espera a esta llamada.
  if not v_panel then
    lock table produccion.pausas_generales in row exclusive mode;
    v_pausa_ini := (produccion._pausa_general_abierta()).inicio;
    if v_pausa_ini is not null then
      return jsonb_build_object('ok', false, 'codigo', 'PAUSA_GENERAL',
        'detalle', to_char(v_pausa_ini at time zone 'America/Montevideo', 'HH24:MI'));
    end if;
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

-- cargar_mp(): como en 014, más el bloqueo por pausa general.
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
  v_pausa_ini timestamptz;
  v_fab    record;
begin
  -- 1. Rol
  if not (v_panel or v_planta) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;
  -- 1b. Pausa general: la planta queda bloqueada hasta el Arranque (el panel no). El lock (hasta el
  -- fin de la transacción) choca con el de pausa_general/arranque_general y no entre llamadas de
  -- planta: si la pausa está en curso se espera y se la ve; si no, la pausa espera a esta llamada.
  if not v_panel then
    lock table produccion.pausas_generales in row exclusive mode;
    v_pausa_ini := (produccion._pausa_general_abierta()).inicio;
    if v_pausa_ini is not null then
      return jsonb_build_object('ok', false, 'codigo', 'PAUSA_GENERAL',
        'detalle', to_char(v_pausa_ini at time zone 'America/Montevideo', 'HH24:MI'));
    end if;
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
revoke execute on function produccion.cargar_mp(uuid, text, boolean, uuid, text) from public, anon;
grant execute on function produccion.cargar_mp(uuid, text, boolean, uuid, text) to authenticated;

-- cargar_consumible(): como en 017, más el bloqueo por pausa general.
create or replace function produccion.cargar_consumible(
  p_id uuid,
  p_lote text,
  p_empleado_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_panel  boolean := produccion.es_panel();
  v_planta boolean := produccion.es_planta();
  v_pausa_ini timestamptz;
  v_c      record;
  v_estado text;
  v_op     uuid;
begin
  -- 1. Rol
  if not (v_panel or v_planta) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;
  -- 1b. Pausa general: la planta queda bloqueada hasta el Arranque (el panel no). El lock (hasta el
  -- fin de la transacción) choca con el de pausa_general/arranque_general y no entre llamadas de
  -- planta: si la pausa está en curso se espera y se la ve; si no, la pausa espera a esta llamada.
  if not v_panel then
    lock table produccion.pausas_generales in row exclusive mode;
    v_pausa_ini := (produccion._pausa_general_abierta()).inicio;
    if v_pausa_ini is not null then
      return jsonb_build_object('ok', false, 'codigo', 'PAUSA_GENERAL',
        'detalle', to_char(v_pausa_ini at time zone 'America/Montevideo', 'HH24:MI'));
    end if;
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

-- 3. Alertas ----------------------------------------------------------------

-- revisar_alertas (parte de 016): con una pausa general abierta borra las resueltas y no crea nada;
-- exceso_9h mide minutos efectivos (sin pausas) en vez de la hora de reloj.
create or replace function produccion.revisar_alertas() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_total int := 0;
  v_n int;
begin
  -- Alertas resueltas: la condición ya no se da (la tarea terminó, se retomó la pausa, se cargó
  -- el envasado, se controló). Se borran; si el problema vuelve, se crea una alerta nueva.
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
             and not exists (select 1 from produccion.envasados v where v.fabricacion_id = f.id)))
     or (a.tipo = 'sin_control' and not exists (
           select 1 from produccion.fabricaciones f where f.id = a.entidad_id and f.estado = 'en_control'));

  -- Con la planta en pausa general no se crean alertas nuevas (las resueltas se borran igual).
  if (produccion._pausa_general_abierta()).id is not null then
    return 0;
  end if;

  -- Más de 9 h efectivas fabricando: desde el inicio, o desde el último rechazo del control,
  -- descontando los tramos de pausa (pausar → reanudar/finalizar/cancelar siguiente, o ahora)
  -- recortados a ese punto de partida.
  insert into produccion.alertas (tipo, entidad, entidad_id, texto)
  select 'exceso_9h', 'fabricacion', f.id,
         format('Fabricación de %s en %s lleva más de 9 horas.', p.nombre, t.codigo)
  from produccion.fabricaciones f
  join produccion.productos p on p.id = f.producto_id
  join produccion.tanques t on t.id = f.tanque_id
  left join lateral (
    select max(e.at) as at from produccion.eventos e
    where e.entidad = 'fabricacion' and e.entidad_id = f.id and e.accion = 'rechazar'
  ) rz on true
  cross join lateral (select greatest(f.inicio, rz.at) as desde) d
  cross join lateral (
    select coalesce(sum(extract(epoch from (coalesce(nx.at, now()) - greatest(pa.at, d.desde)))), 0) / 60 as min_pausa
    from produccion.eventos pa
    left join lateral (
      select min(x.at) as at from produccion.eventos x
      where x.entidad = 'fabricacion' and x.entidad_id = f.id
        and x.accion in ('reanudar', 'finalizar', 'cancelar') and x.at > pa.at
    ) nx on true
    where pa.entidad = 'fabricacion' and pa.entidad_id = f.id and pa.accion = 'pausar'
      and coalesce(nx.at, now()) > d.desde
  ) pz
  where f.estado in ('fabricando', 'pausada')
    and extract(epoch from (now() - d.desde)) / 60 - pz.min_pausa > 540
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
  left join produccion.v_tiempos_efectivos te on te.entidad = 'envasado' and te.entidad_id = v.id
  where v.estado in ('activo', 'pausado')
    -- minutos efectivos; sin evento «iniciar» (filas viejas) cae al reloj desde envasados.inicio
    and coalesce(te.min_efectivos, extract(epoch from (now() - v.inicio)) / 60) > 540
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

  -- Fabricación esperando el control hace más de 1 h (desde el último «finalizar»)
  insert into produccion.alertas (tipo, entidad, entidad_id, texto)
  select 'sin_control', 'fabricacion', f.id,
         format('Fabricación de %s en %s lleva más de 1 h esperando el control.', p.nombre, t.codigo)
  from produccion.fabricaciones f
  join produccion.productos p on p.id = f.producto_id
  join produccion.tanques t on t.id = f.tanque_id
  join lateral (
    select max(e.at) as at from produccion.eventos e
    where e.entidad = 'fabricacion' and e.entidad_id = f.id and e.accion = 'finalizar'
  ) fz on true
  where f.estado = 'en_control' and fz.at < now() - interval '1 hour'
  on conflict (tipo, entidad_id) do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;
