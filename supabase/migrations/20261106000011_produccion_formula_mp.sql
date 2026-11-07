-- ProdControl · 011 — fórmula desde PDF: materias primas por fabricación, checklist en planta y bloqueo de finalizar

-- Datos de la fórmula ------------------------------------------------------
alter table produccion.fabricaciones
  add column vencimiento   date,
  add column fecha_formula date;

-- mismo criterio que 005: el panel edita columnas de datos, nunca estado/inicio/fin
grant insert (vencimiento, fecha_formula), update (vencimiento, fecha_formula)
  on produccion.fabricaciones to authenticated;

-- código del granel en la fórmula (p. ej. F8); se completa solo al crear la primera orden desde un PDF
alter table produccion.productos add column codigo text unique;

-- Materias primas de cada fabricación (orden = renglón de la fórmula) --------
create table produccion.fabricacion_mp (
  id             uuid primary key default gen_random_uuid(),
  fabricacion_id uuid not null references produccion.fabricaciones (id) on delete cascade,
  orden          int  not null,
  codigo         text not null,
  descripcion    text not null,
  cantidad       numeric not null check (cantidad > 0),
  lote           text,
  pesado         boolean not null default false,
  cargado_por    uuid references produccion.operarias (empleado_id),
  cargado_at     timestamptz,
  unique (fabricacion_id, orden)
);
create index fabricacion_mp_cargado_por_idx on produccion.fabricacion_mp (cargado_por);

-- solo lectura por la API: se escribe únicamente desde las RPC (security definer)
alter table produccion.fabricacion_mp enable row level security;
grant select on produccion.fabricacion_mp to authenticated;
create policy fabricacion_mp_leer on produccion.fabricacion_mp for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));

-- Crear una orden desde la fórmula ---------------------------------------------
-- p_fab = {tanque_id, producto_id, litros, lote, vencimiento, fecha_formula, operaria_id, codigo_producto}
-- p_mp  = [{codigo, descripcion, cantidad}, …]  (orden = posición en el array)
-- Errores de negocio como {ok:false, codigo, detalle}; todo o nada.
create function produccion.crear_fabricacion_formula(p_fab jsonb, p_mp jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lote   text := nullif(trim(p_fab->>'lote'), '');
  v_cod    text := nullif(trim(p_fab->>'codigo_producto'), '');
  v_prod   uuid;
  v_id     uuid;
  v_constr text;
  v_det    text;
begin
  if not produccion.es_panel() then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  begin
    v_prod := (p_fab->>'producto_id')::uuid;

    -- serializa dos altas simultáneas con el mismo lote
    if v_lote is not null then
      perform pg_advisory_xact_lock(hashtext('produccion.fabricaciones.lote:' || v_lote));
      if exists (
        select 1 from produccion.fabricaciones f
        where f.lote = v_lote and f.estado <> 'cancelada'
      ) then
        return jsonb_build_object('ok', false, 'codigo', 'LOTE_DUPLICADO', 'detalle', v_lote);
      end if;
    end if;

    insert into produccion.fabricaciones (tanque_id, producto_id, litros, lote, vencimiento, fecha_formula, operaria_id)
    values (
      (p_fab->>'tanque_id')::uuid, v_prod, (p_fab->>'litros')::numeric, v_lote,
      (p_fab->>'vencimiento')::date, (p_fab->>'fecha_formula')::date, (p_fab->>'operaria_id')::uuid
    )
    returning id into v_id;

    insert into produccion.fabricacion_mp (fabricacion_id, orden, codigo, descripcion, cantidad)
    select v_id, e.n::int, trim(e.mp->>'codigo'), trim(e.mp->>'descripcion'), (e.mp->>'cantidad')::numeric
    from jsonb_array_elements(coalesce(p_mp, '[]'::jsonb)) with ordinality as e(mp, n);
  exception
    when unique_violation then
      get stacked diagnostics v_constr = constraint_name;
      if v_constr = 'fabricaciones_tanque_abierta_uk' then
        return jsonb_build_object('ok', false, 'codigo', 'TANQUE_OCUPADO', 'detalle', null);
      end if;
      raise;
    when not_null_violation or check_violation or foreign_key_violation
         or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      -- datos mal armados (tanque/producto inexistente, litros ≤ 0, fecha o uuid inválidos…)
      get stacked diagnostics v_det = message_text;
      return jsonb_build_object('ok', false, 'codigo', 'DATOS_INVALIDOS', 'detalle', v_det);
  end;

  -- el producto adopta el código de la fórmula si no tiene y nadie más lo usa; si no, se ignora
  if v_cod is not null then
    begin
      update produccion.productos p set codigo = v_cod
      where p.id = v_prod and p.codigo is null
        and not exists (select 1 from produccion.productos o where o.codigo = v_cod);
    exception when unique_violation then
      null; -- otro producto lo tomó en paralelo: se ignora
    end;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Checklist de MP en planta (o desde el panel) ---------------------------------
-- Planta: operaria activa + PIN (como accion()) y tiene que ser la asignada a la fabricación (si tiene una).
create function produccion.cargar_mp(
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
  v_pin    text;
  v_fab    record;
begin
  -- 1. Rol
  if not (v_panel or v_planta) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  -- 2. Dispositivo de planta: operaria activa + PIN (idéntico a accion())
  if not v_panel then
    if p_empleado_id is null or p_pin is null then
      return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
    end if;
    if not exists (
      select 1 from produccion.operarias o
      join core.funcionarios f on f.id = o.empleado_id
      where o.empleado_id = p_empleado_id and o.activo and f.estado <> 'baja'
    ) then
      return jsonb_build_object('ok', false, 'codigo', 'OPERARIA_INACTIVA', 'detalle', null);
    end if;
    v_pin := produccion._verificar_pin(p_empleado_id, p_pin);
    if v_pin = 'bloqueado' then
      return jsonb_build_object('ok', false, 'codigo', 'PIN_BLOQUEADO', 'detalle', null);
    elsif v_pin <> 'ok' then
      return jsonb_build_object('ok', false, 'codigo', 'PIN_INCORRECTO', 'detalle', null);
    end if;
  end if;

  -- 3. Fabricación de la MP (bloqueada: serializa con accion('finalizar'))
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
  -- sin operaria asignada (alta sin operaria, iniciada desde el panel) cualquiera con PIN válido puede cargar
  if not v_panel and v_fab.operaria_id is not null and p_empleado_id <> v_fab.operaria_id then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
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

revoke execute on function produccion.crear_fabricacion_formula(jsonb, jsonb) from public, anon;
revoke execute on function produccion.cargar_mp(uuid, text, boolean, uuid, text) from public, anon;
grant execute on function produccion.crear_fabricacion_formula(jsonb, jsonb) to authenticated;
grant execute on function produccion.cargar_mp(uuid, text, boolean, uuid, text) to authenticated;

-- v_tareas: igual que en 006 + avance del checklist de MP (0/0 para envasado y fraccionado) ------
create or replace view produccion.v_tareas with (security_invoker = true) as
select
  'fabricacion'::text as entidad, f.id, f.estado,
  p.nombre as producto, p.color, t.codigo as tanque_codigo,
  null::text as presentacion, null::int as cantidad, f.litros, f.lote, null::text as descripcion,
  f.operaria_id as operaria_1, null::uuid as operaria_2,
  true as listo, f.inicio, te.min_efectivos, f.estado = 'fabricando' as corriendo, f.created_at,
  mp.mp_total, mp.mp_completas
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
  0, 0
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
  0, 0
from produccion.fraccionados x
left join produccion.productos p on p.id = x.producto_id
left join produccion.presentaciones pe on pe.id = x.presentacion_id
left join produccion.v_tiempos_efectivos te on te.entidad = 'fraccionado' and te.entidad_id = x.id
where x.estado in ('cola', 'activo', 'pausado');

-- accion(): igual que en 006 + 4b (no se finaliza la fabricación con MP sin lote o sin pesar).
create or replace function produccion.accion(
  p_entidad text,
  p_id uuid,
  p_accion text,
  p_empleado_id uuid default null,
  p_pin text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_panel   boolean := produccion.es_panel();
  v_planta  boolean := produccion.es_planta();
  v_pin     text;
  v_estado  text;
  v_nuevo   text;
  v_fab_id  uuid;
  v_op      uuid;
  v_fila    jsonb;
  v_cerrada boolean := false;
  v_disp    text;
  v_det     text;
  v_msg     text;
  v_mp      int;
  v_fab     record;
  v_ev      record;
begin
  if p_entidad is null or p_entidad not in ('fabricacion', 'envasado', 'fraccionado')
     or p_accion is null or p_accion not in ('iniciar', 'pausar', 'reanudar', 'finalizar', 'cancelar') then
    raise exception using errcode = '22023', message = 'ACCION_DESCONOCIDA',
      detail = format('%s/%s', p_entidad, p_accion);
  end if;

  -- 1. Rol
  if not (v_panel or v_planta) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
  end if;

  -- 2. Dispositivo de planta: operaria activa + PIN
  if not v_panel then
    if p_empleado_id is null or p_pin is null or p_accion = 'cancelar' then
      return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
    end if;
    if not exists (
      select 1 from produccion.operarias o
      join core.funcionarios f on f.id = o.empleado_id
      where o.empleado_id = p_empleado_id and o.activo and f.estado <> 'baja'
    ) then
      return jsonb_build_object('ok', false, 'codigo', 'OPERARIA_INACTIVA', 'detalle', null);
    end if;
    v_pin := produccion._verificar_pin(p_empleado_id, p_pin);
    if v_pin = 'bloqueado' then
      return jsonb_build_object('ok', false, 'codigo', 'PIN_BLOQUEADO', 'detalle', null);
    elsif v_pin <> 'ok' then
      return jsonb_build_object('ok', false, 'codigo', 'PIN_INCORRECTO', 'detalle', null);
    end if;
    select email into v_disp from public.perfiles where id = auth.uid();
  end if;

  -- 3..7. Negocio, atómico (errores con SQLSTATE PC001 → respuesta {ok:false})
  begin
    -- 3. Bloquear la fila
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

    -- 4. Transición
    if p_entidad = 'fabricacion' then
      v_nuevo := case
        when p_accion = 'iniciar'   and v_estado = 'cola'       then 'fabricando'
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
        when p_accion = 'pausar'    and v_estado = 'activo'  then 'pausado'
        when p_accion = 'reanudar'  and v_estado = 'pausado' then 'activo'
        when p_accion = 'finalizar' and v_estado = 'activo'  then 'finalizado'
        when p_accion = 'cancelar'  and v_estado in ('cola', 'activo', 'pausado') then 'cancelado'
      end;
    end if;

    if v_nuevo is null then
      select e.accion, e.at, coalesce(f.nombre, p.nombre, 'la encargada') as quien into v_ev
      from produccion.eventos e
      left join core.funcionarios f on f.id = e.empleado_id
      left join public.perfiles p on p.id = e.usuario_id
      where e.entidad = p_entidad and e.entidad_id = p_id
      order by e.at desc, e.id desc
      limit 1;

      if found and v_ev.accion in ('iniciar', 'pausar', 'reanudar', 'finalizar', 'cancelar') then
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

    -- 5. Reglas de envasado
    if p_entidad = 'envasado' and p_accion = 'iniciar' then
      if (select estado from produccion.fabricaciones where id = v_fab_id) <> 'para_envasar' then
        raise exception using errcode = 'PC001', message = 'TANQUE_NO_LISTO';
      end if;
    end if;
    if p_entidad = 'envasado' and p_accion in ('iniciar', 'reanudar') and coalesce(p_empleado_id, v_op) is not null then
      -- lock por operaria: serializa dos inicios simultáneos de la misma persona
      perform 1 from produccion.operarias where empleado_id = coalesce(p_empleado_id, v_op) for update;
      select pr.nombre || ' ' || pe.nombre into v_det
      from produccion.envasados v
      join produccion.fabricaciones f on f.id = v.fabricacion_id
      join produccion.productos pr on pr.id = f.producto_id
      join produccion.presentaciones pe on pe.id = v.presentacion_id
      where v.estado = 'activo' and v.id <> p_id
        and coalesce(p_empleado_id, v_op) in (v.operaria_1, v.operaria_2)
      limit 1;
      if found then
        raise exception using errcode = 'PC001', message = 'OPERARIA_OCUPADA', detail = v_det;
      end if;
    end if;

    -- 6. Efectos
    if p_entidad = 'fabricacion' then
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

    insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, dispositivo)
    values (p_entidad, p_id, p_accion, p_empleado_id, auth.uid(), v_disp);

    -- 7. Cierre automático de la fabricación al terminar de envasar
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
