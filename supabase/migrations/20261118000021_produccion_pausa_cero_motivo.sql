-- 021: Pausa General acepta cantidad 0 con motivo.
-- Si una operaria no llegó a hacer nada, la encargada pone 0 y escribe por qué. El motivo queda en la
-- participación (y en el evento «salir») y se ve en el detalle de la orden y en el historial.

-- 1. participaciones: cantidad puede ser 0, pero solo con motivo -------------------------------
alter table produccion.participaciones add column motivo text;
alter table produccion.participaciones drop constraint participaciones_cantidad_check;
alter table produccion.participaciones add constraint participaciones_cantidad_check check (cantidad >= 0);
alter table produccion.participaciones add constraint participaciones_cero_con_motivo
  check (cantidad is distinct from 0 or nullif(btrim(motivo), '') is not null);

-- 2. v_historial: el motivo viaja en el jsonb de participaciones (mismo texto, una clave más) ------
do $$
declare
  d text := pg_get_viewdef('produccion.v_historial'::regclass);
  viejo text := '''cantidad_corregida'', pa.cantidad_corregida,';
  n int := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
begin
  if n <> 3 then
    raise exception 'v_historial cambió: esperaba 3 bloques de participaciones, hay %', n;
  end if;
  execute 'create or replace view produccion.v_historial with (security_invoker = true) as '
    || replace(d, viejo, viejo || ' ''motivo'', pa.motivo,');
end $$;

-- 3. pausa_general: cantidad >= 0; con 0 exige motivo (MOTIVO_REQUERIDO) -----------------------
-- pausa_general: pausa todas las órdenes en marcha y saca a cada operaria con su cantidad.
-- p_cantidades = [{entidad, entidad_id, empleado_id, cantidad, unidad, motivo?}] (envasado/fraccionado;
-- cantidad 0 solo con motivo: la operaria no llegó a hacer nada y la encargada explica por qué;
-- en fabricación se ignoran). Mismo contrato que accion(): errores de negocio como {ok:false}.
create or replace function produccion.pausa_general(p_cantidades jsonb)
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
  v_mot     text;
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
        v_mot  := null;
        if v_o.entidad <> 'fabricacion' then
          v_item := null;
          select e.value into v_item
          from jsonb_array_elements(coalesce(p_cantidades, '[]'::jsonb)) e
          where e.value->>'entidad' = v_o.entidad
            and e.value->>'entidad_id' = v_o.id::text
            and e.value->>'empleado_id' = v_p.empleado_id::text
          limit 1;
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
          if v_item is null
             or not (case when jsonb_typeof(v_item->'cantidad') = 'number'
                          then (v_item->>'cantidad')::numeric >= 0 else false end)
             or coalesce(v_item->>'unidad', '') not in ('L', 'kg') then
            raise exception using errcode = 'PC001', message = 'CANTIDAD_REQUERIDA',
              detail = format('%s en %s', v_quien, v_orden);
          end if;
          v_cant := (v_item->>'cantidad')::numeric;
          v_uni  := v_item->>'unidad';
          v_mot  := nullif(btrim(coalesce(v_item->>'motivo', '')), '');
          if v_cant > 0 then
            v_mot := null; -- el motivo solo acompaña al 0
          elsif v_mot is null then
            raise exception using errcode = 'PC001', message = 'MOTIVO_REQUERIDO',
              detail = format('%s en %s', v_quien, v_orden);
          end if;
        end if;

        update produccion.participaciones set hasta = now(), cantidad = v_cant, unidad = v_uni, motivo = v_mot
        where id = v_p.id;
        insert into produccion.eventos (entidad, entidad_id, accion, empleado_id, usuario_id, datos)
        values (v_o.entidad, v_o.id, 'salir', v_p.empleado_id, auth.uid(),
          jsonb_build_object('pausa_general', v_pausa)
          || case when v_cant is null then '{}'::jsonb
                  else jsonb_build_object('cantidad', v_cant, 'unidad', v_uni) end
          || case when v_mot is null then '{}'::jsonb else jsonb_build_object('motivo', v_mot) end);
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
