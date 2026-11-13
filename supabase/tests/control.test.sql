-- Ejecutar: begin; + 015 + _fixtures.sql + este archivo (execute_sql no soporta \i).
-- Control para liberación, parte 1: estado en_control y tabla controles (migración 015).
insert into _tap (l) select plan(48);
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


-- 9. registrar_control y listar_liberadoras
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a4', 'test-admin@prodcontrol.test',    'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a5', 'test-inactivo@prodcontrol.test', 'authenticated', 'authenticated');
update public.perfiles set rol = 'admin', nombre = 'Ana Admin' where id = '00000000-0000-0000-0000-0000000000a4';
update public.perfiles set rol_produccion = 'panel', activo = false, nombre = 'Zoe Inactiva' where id = '00000000-0000-0000-0000-0000000000a5';
update public.perfiles set nombre = 'Marta Panel' where id = '00000000-0000-0000-0000-0000000000a1';
insert into produccion.tanques (id, codigo, capacidad_l, orden) values ('00000000-0000-0000-0000-0000000000c2', 'T-TEST2', 2000, 2);
insert into produccion.productos (id, nombre, color, tipo) values ('00000000-0000-0000-0000-0000000000d2', 'Polvo-test', '#65a30d', 'polvo');
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, inicio, fin) values
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 1000, 'en_control', now(), now()),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d2', 500, 'en_control', now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, true, null, true, null, null, 'aprobado')->>'codigo',
  'NO_AUTORIZADO', 'planta sin firmante: NO_AUTORIZADO');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a3')->>'codigo',
  'NO_AUTORIZADO', 'firmante sin rol: NO_AUTORIZADO');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a5')->>'codigo',
  'NO_AUTORIZADO', 'firmante inactivo: NO_AUTORIZADO');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, false, '   ', true, null, null, 'rechazado', '00000000-0000-0000-0000-0000000000a4')->>'codigo',
  'DATOS_INVALIDOS', 'No OK sin comentario (solo espacios): DATOS_INVALIDOS');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 15, 1.01, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a4')->>'codigo',
  'DATOS_INVALIDOS', 'pH 15: DATOS_INVALIDOS');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 0, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a4')->>'codigo',
  'DATOS_INVALIDOS', 'densidad 0: DATOS_INVALIDOS');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', null, 1.01, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a4')->>'codigo',
  'DATOS_INVALIDOS', 'pH null en un producto no polvo: DATOS_INVALIDOS');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, true, null, true, null, null, 'quizas', '00000000-0000-0000-0000-0000000000a4')->>'codigo',
  'DATOS_INVALIDOS', 'resultado inválido: DATOS_INVALIDOS');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, true, null, true, null, '   ', 'rechazado', '00000000-0000-0000-0000-0000000000a4')->>'codigo',
  'DATOS_INVALIDOS', 'rechazar con todo OK y sin observaciones: DATOS_INVALIDOS');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b9', 7, 1.01, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a4')->>'codigo',
  'NO_ENCONTRADO', 'fabricación inexistente: NO_ENCONTRADO');

-- rechazo desde la tablet con firmante admin
insert into _tap (l) select is(
  (produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, false, ' muy suave ', true, null, ' revisar ', 'rechazado', '00000000-0000-0000-0000-0000000000a4')->>'intento')::int,
  1, 'planta rechaza con firmante admin: intento 1');
reset role;
insert into _tap (l) select is(
  (select estado || '/' || (fin is null)::text from produccion.fabricaciones where id = '00000000-0000-0000-0000-0000000000b3'),
  'fabricando/true', 'rechazado: vuelve a fabricando y sin fin');
insert into _tap (l) select is(
  (select (datos->>'motivo') || '|' || usuario_id::text || '|' || (datos->>'intento') from produccion.eventos
   where entidad_id = '00000000-0000-0000-0000-0000000000b3' and accion = 'rechazar'),
  'perfume No OK (muy suave); revisar|00000000-0000-0000-0000-0000000000a4|1', 'evento rechazar: motivo, firmante e intento');
insert into _tap (l) select is(
  (select firmado_nombre || '/' || origen from produccion.controles where fabricacion_id = '00000000-0000-0000-0000-0000000000b3' and intento = 1),
  'Ana Admin/tablet', 'control 1: firmante y origen tablet');

-- refinalizar y aprobar desde el panel (firma el usuario logueado, p_firmante se ignora)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b3', 'finalizar', '00000000-0000-0000-0000-0000000000e1')->>'estado',
  'en_control', 'refinalizar deja la fabricación otra vez en_control');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is(
  (produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7.2, 1.02, true, null, true, null, '', 'aprobado', '00000000-0000-0000-0000-0000000000a4')->>'intento')::int,
  2, 'panel aprueba: intento 2');
reset role;
insert into _tap (l) select is(
  (select estado || '/' || (fin is not null)::text from produccion.fabricaciones where id = '00000000-0000-0000-0000-0000000000b3'),
  'para_envasar/true', 'aprobado: queda para_envasar');
insert into _tap (l) select is(
  (select firmado_por::text || '/' || origen || '/' || coalesce(observaciones, 'null') from produccion.controles
   where fabricacion_id = '00000000-0000-0000-0000-0000000000b3' and intento = 2),
  '00000000-0000-0000-0000-0000000000a1/panel/null', 'control 2: firma el uid del panel, origen panel, observaciones vacías = null');
insert into _tap (l) select is(
  (select usuario_id::text || '|' || (datos->>'motivo') from produccion.eventos where entidad_id = '00000000-0000-0000-0000-0000000000b3' and accion = 'aprobar'),
  '00000000-0000-0000-0000-0000000000a1|', 'evento aprobar: usuario = firmante, motivo vacío');

-- un segundo control tras aprobar no entra
set local role authenticated;
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, true, null, true, null, null, 'aprobado')->>'codigo',
  'TRANSICION_INVALIDA', 'segundo control tras aprobar: TRANSICION_INVALIDA');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b1', 7, 1.01, true, null, true, null, null, 'aprobado')->>'codigo',
  'TRANSICION_INVALIDA', 'fabricación cancelada: TRANSICION_INVALIDA');
reset role;
insert into _tap (l) select is(
  (select count(*)::int from produccion.controles where fabricacion_id = '00000000-0000-0000-0000-0000000000b3'), 2, 'no se guardó un tercer control');

-- producto polvo: sin pH ni densidad, y los que vengan se descartan
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  (produccion.registrar_control('00000000-0000-0000-0000-0000000000b4', null, null, true, null, true, null, 'grumoso', 'rechazado', '00000000-0000-0000-0000-0000000000a1')->>'ok')::boolean,
  true, 'polvo sin pH ni densidad, rechazo con todo OK pero con observaciones: ok');
reset role;
update produccion.fabricaciones set estado = 'en_control', fin = now() where id = '00000000-0000-0000-0000-0000000000b4';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  (produccion.registrar_control('00000000-0000-0000-0000-0000000000b4', 99, -5, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a1')->>'intento')::int,
  2, 'polvo con pH y densidad absurdos: ok (se ignoran)');
reset role;
insert into _tap (l) select is(
  (select count(*)::int from produccion.controles where fabricacion_id = '00000000-0000-0000-0000-0000000000b4' and (ph is not null or densidad is not null)),
  0, 'polvo: pH y densidad quedan null');

-- listar_liberadoras
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  (select array_agg(l.nombre) from produccion.listar_liberadoras() l where l.id::text like '00000000-0000-0000-0000-0000000000a%'),
  array['Ana Admin', 'Marta Panel'], 'listar_liberadoras: solo activos con admin o panel, por nombre (planta puede)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select lives_ok($$select * from produccion.listar_liberadoras()$$, 'el panel puede listar liberadoras');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into _tap (l) select throws_ok($$select * from produccion.listar_liberadoras()$$, '42501', 'NO_AUTORIZADO', 'sin acceso no lista liberadoras');
insert into _tap (l) select is(
  produccion.registrar_control('00000000-0000-0000-0000-0000000000b3', 7, 1.01, true, null, true, null, null, 'aprobado', '00000000-0000-0000-0000-0000000000a1')->>'codigo',
  'NO_AUTORIZADO', 'sin acceso no registra controles');
reset role;

insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
