-- 016: alerta para fabricaciones trabadas «En control» + la alerta de 9 h cuenta desde el último rechazo.
-- 1) Nuevo tipo de alerta 'sin_control': más de 1 h en en_control (desde el último «finalizar»).
-- 2) exceso_9h de fabricación: el reloj arranca en el último «rechazar» si lo hay (antes saltaba
--    apenas un rechazo devolvía a «fabricando» una fabricación iniciada hace muchas horas).

alter table produccion.alertas drop constraint alertas_tipo_check;
alter table produccion.alertas add constraint alertas_tipo_check
  check (tipo in ('exceso_9h', 'desvio_estandar', 'pausa_larga', 'falta_envasado', 'sin_control'));

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

  -- Más de 9 h fabricando (desde el inicio, o desde el último rechazo del control)
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
  where f.estado in ('fabricando', 'pausada')
    and greatest(f.inicio, rz.at) < now() - interval '9 hours'
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
  where v.estado in ('activo', 'pausado') and v.inicio < now() - interval '9 hours'
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
