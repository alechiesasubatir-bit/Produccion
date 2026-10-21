-- ProdControl · 005 — el estado de las tareas solo cambia vía accion(); cierre manual con merma
--
-- I1: con grants de tabla, el panel podía hacer UPDATE de estado/inicio/fin por la API, salteando
--     las transiciones y sin dejar evento. Ahora INSERT/UPDATE se otorgan solo sobre columnas de datos;
--     estado, inicio, fin y creado_por los escriben únicamente la RPC (security definer) y los defaults.
-- I2: una fabricación para_envasar con merma (Σ envasado < litros) no tenía salida. accion() ahora
--     permite al panel 'finalizar' desde para_envasar → finalizada.

revoke insert, update on produccion.fabricaciones, produccion.envasados, produccion.fraccionados from authenticated;

grant insert (tanque_id, producto_id, litros, lote, operaria_id),
      update (tanque_id, producto_id, litros, lote, operaria_id)
  on produccion.fabricaciones to authenticated;
grant insert (fabricacion_id, presentacion_id, cantidad, etiquetado, operaria_1, operaria_2),
      update (fabricacion_id, presentacion_id, cantidad, etiquetado, operaria_1, operaria_2)
  on produccion.envasados to authenticated;
grant insert (tipo, descripcion, producto_id, presentacion_id, cantidad, lote, etiquetado, operaria_id),
      update (tipo, descripcion, producto_id, presentacion_id, cantidad, lote, etiquetado, operaria_id)
  on produccion.fraccionados to authenticated;

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

      if v_fab.estado = 'para_envasar' and v_fab.litros - coalesce((
           select sum(v.cantidad * pe.litros_equiv)
           from produccion.envasados v
           join produccion.presentaciones pe on pe.id = v.presentacion_id
           where v.fabricacion_id = v_fab.id and v.estado = 'finalizado'
         ), 0) <= 0 then
        update produccion.fabricaciones set estado = 'finalizada', fin = now() where id = v_fab.id;
        insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, dispositivo, datos)
        values ('fabricacion', v_fab.id, 'finalizar', null, auth.uid(), v_disp, '{"auto": true}');
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
