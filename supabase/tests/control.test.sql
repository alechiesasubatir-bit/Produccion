-- Ejecutar: begin; + 015 + _fixtures.sql + este archivo (execute_sql no soporta \i).
-- Control para liberación, parte 1: estado en_control y tabla controles (migración 015).
insert into _tap (l) select plan(19);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres): B1 fabricando en T-TEST (E1) con un envasado en cola
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, operaria_id, inicio) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1',
   1000, 'fabricando', '00000000-0000-0000-0000-0000000000e1', now());
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000f1', 10, 'cola');

-- 1. finalizar desde la tablet deja la fabricación en control
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'finalizar',
    '00000000-0000-0000-0000-0000000000e1')->>'estado',
  'en_control', 'finalizar una fabricación la deja en_control');

-- 2. el tanque sigue ocupado
reset role;
insert into _tap (l) select throws_ok(
  $$insert into produccion.fabricaciones (tanque_id, producto_id, litros, estado)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 100, 'cola')$$,
  '23505', null, 'segunda orden en un tanque en_control: error de índice único');

-- 3. no se envasa hasta aprobar
set local role authenticated;
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000b2', 'iniciar',
    '00000000-0000-0000-0000-0000000000e1')->>'codigo',
  'TANQUE_NO_LISTO', 'envasado sobre fabricación en_control: TANQUE_NO_LISTO');

-- 4. la tablet no cancela en control; el panel sí (más abajo)
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'cancelar')->>'codigo',
  'NO_AUTORIZADO', 'la tablet no cancela una fabricación en_control');

-- Un control cargado por postgres para probar RLS y restricciones
reset role;
insert into produccion.controles (id, fabricacion_id, intento, ph, densidad, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen) values
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000b1', 1, 7.2, 1.01, true, true, 'rechazado',
   '00000000-0000-0000-0000-0000000000a1', 'Panel Test', 'panel');

-- 5. RLS: lectura panel y planta; sin acceso no ve nada; nadie escribe directo
insert into _tap (l) select ok(
  (select relrowsecurity from pg_class where oid = 'produccion.controles'::regclass), 'controles tiene RLS');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is((select count(*)::int from produccion.controles), 1, 'planta lee controles');
insert into _tap (l) select throws_ok(
  $$insert into produccion.controles (fabricacion_id, intento, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen)
    values ('00000000-0000-0000-0000-0000000000b1', 2, true, true, 'aprobado', '00000000-0000-0000-0000-0000000000a2', 'X', 'tablet')$$,
  '42501', null, 'planta no inserta controles directo');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into _tap (l) select is((select count(*)::int from produccion.controles), 0, 'un usuario sin acceso no ve controles');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is((select count(*)::int from produccion.controles), 1, 'panel lee controles');
insert into _tap (l) select throws_ok(
  $$insert into produccion.controles (fabricacion_id, intento, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen)
    values ('00000000-0000-0000-0000-0000000000b1', 2, true, true, 'aprobado', '00000000-0000-0000-0000-0000000000a1', 'X', 'panel')$$,
  '42501', null, 'panel tampoco inserta controles directo');

-- 6. cancelar desde el panel en en_control
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'cancelar')->>'estado',
  'cancelada', 'el panel cancela una fabricación en_control');

-- 7. restricciones (como postgres)
reset role;
insert into _tap (l) select throws_ok(
  $$insert into produccion.controles (fabricacion_id, intento, ph, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen)
    values ('00000000-0000-0000-0000-0000000000b1', 2, 15, true, true, 'aprobado', '00000000-0000-0000-0000-0000000000a1', 'X', 'panel')$$,
  '23514', null, 'pH fuera de 0–14 no entra');
insert into _tap (l) select throws_ok(
  $$insert into produccion.controles (fabricacion_id, intento, densidad, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen)
    values ('00000000-0000-0000-0000-0000000000b1', 2, 0, true, true, 'aprobado', '00000000-0000-0000-0000-0000000000a1', 'X', 'panel')$$,
  '23514', null, 'densidad 0 no entra');
insert into _tap (l) select throws_ok(
  $$insert into produccion.controles (fabricacion_id, intento, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen)
    values ('00000000-0000-0000-0000-0000000000b1', 2, true, true, 'quizas', '00000000-0000-0000-0000-0000000000a1', 'X', 'panel')$$,
  '23514', null, 'resultado inválido no entra');
insert into _tap (l) select throws_ok(
  $$insert into produccion.controles (fabricacion_id, intento, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen)
    values ('00000000-0000-0000-0000-0000000000b1', 2, true, true, 'aprobado', '00000000-0000-0000-0000-0000000000a1', 'X', 'otro')$$,
  '23514', null, 'origen inválido no entra');
insert into _tap (l) select throws_ok(
  $$insert into produccion.controles (fabricacion_id, intento, perfume_ok, visual_ok, resultado, firmado_por, firmado_nombre, origen)
    values ('00000000-0000-0000-0000-0000000000b1', 1, true, true, 'aprobado', '00000000-0000-0000-0000-0000000000a1', 'X', 'panel')$$,
  '23505', null, 'no se repite el intento de una fabricación');

-- 8. eventos aprobar / rechazar y realtime
insert into _tap (l) select lives_ok(
  $$insert into produccion.eventos (entidad, entidad_id, accion) values ('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'aprobar')$$,
  'eventos admite accion aprobar');
insert into _tap (l) select lives_ok(
  $$insert into produccion.eventos (entidad, entidad_id, accion) values ('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'rechazar')$$,
  'eventos admite accion rechazar');
insert into _tap (l) select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'produccion' and tablename = 'controles'),
  'controles está en supabase_realtime');

insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
