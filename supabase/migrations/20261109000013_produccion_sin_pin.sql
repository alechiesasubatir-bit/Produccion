-- 013: la tablet deja de pedir PIN. accion() y cargar_mp() ya no lo verifican: desde planta alcanza
-- con una operaria activa (el dispositivo ya está logueado con el rol planta). p_pin queda en la firma
-- (se ignora) para no romper clientes viejos; pin_hash, set_pin y verificar_pin quedan sin uso.

-- Planta: operaria activa y tiene que ser la asignada a la fabricación (si tiene una).
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
  -- sin operaria asignada (alta sin operaria, iniciada desde el panel) cualquier operaria activa puede cargar
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

  -- 2. Dispositivo de planta: operaria activa (sin PIN desde 013)
  if not v_panel then
    if p_empleado_id is null or p_accion = 'cancelar' then
      return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO', 'detalle', null);
    end if;
    if not exists (
      select 1 from produccion.operarias o
      join core.funcionarios f on f.id = o.empleado_id
      where o.empleado_id = p_empleado_id and o.activo and f.estado <> 'baja'
    ) then
      return jsonb_build_object('ok', false, 'codigo', 'OPERARIA_INACTIVA', 'detalle', null);
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
