-- Ejecutar: begin; + 013 + 014 + _fixtures.sql + este archivo (execute_sql no soporta \i).
insert into _tap (l) select plan(27);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres): un envasado activo con operaria_1 "previo a la migración"
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar');
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, operaria_1, estado, inicio) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000f1', 100, '00000000-0000-0000-0000-0000000000e1', 'activo', now() - interval '2 hours');
select produccion._migrar_participaciones();
select produccion._migrar_participaciones();  -- idempotente

insert into _tap (l) select is(
  (select count(*)::int || '/' || bool_and(desde = (select inicio from produccion.envasados where id = '00000000-0000-0000-0000-0000000000b2'))::text
   from produccion.participaciones where entidad_id = '00000000-0000-0000-0000-0000000000b2' and hasta is null),
  '1/true', 'envasado activo migrado: 1 participación abierta con desde = inicio (idempotente)');

insert into _tap (l) select throws_ok(
  $$insert into produccion.participaciones (entidad, entidad_id, empleado_id)
    values ('envasado', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1')$$,
  '23505', null, 'no hay dos participaciones abiertas de la misma operaria');

insert into _tap (l) select ok(
  (select relrowsecurity from pg_class where oid = 'produccion.participaciones'::regclass),
  'participaciones tiene RLS');

insert into _tap (l) select lives_ok(
  $$insert into produccion.eventos (entidad, entidad_id, accion)
    values ('envasado', '00000000-0000-0000-0000-0000000000b2', 'sumarse')$$,
  'eventos admite accion sumarse');

-- Planta
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select throws_ok(
  $$insert into produccion.participaciones (entidad, entidad_id, empleado_id)
    values ('envasado', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e2')$$,
  '42501', null, 'planta no puede insertar participaciones directo');

-- Panel
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select throws_ok(
  $$update produccion.envasados set etiqueta_id = '00000000-0000-0000-0000-0000000000e8'
    where id = '00000000-0000-0000-0000-0000000000b2'$$,
  'PC001', 'ETIQUETA_INACTIVA', 'no se asigna una etiqueta inactiva');

-- accion(): sumarse / salir / cantidades; cargar_mp() por participación -----------------------
-- Escenario (como postgres). E4 (Eva Test) es una tercera operaria activa.
--   F2 …201 (T-TEST2, para_envasar 1000 L) con envasados A …301, B …302, C …303 en cola (10 × 5L) y …306 (1 × 5L)
--   F3 …202 (T-TEST3, cola) con una MP · F4 …203 (T-TEST4, fabricando, sin participaciones)
--   F5 …204 (T-TEST5, para_envasar 10 L, participación abierta de E1) con envasado E …305 activo (3 × 5L)
reset role;
-- el envasado migrado de arriba (E1, activo) se da por terminado: si no, E1 queda ocupada
update produccion.envasados set estado = 'finalizado', fin = now() where id = '00000000-0000-0000-0000-0000000000b2';
update produccion.participaciones set hasta = now() where entidad_id = '00000000-0000-0000-0000-0000000000b2';
insert into core.funcionarios (id, nombre, cedula, fecha_ingreso, cargo, sector, tipo_contrato, estado) values
  ('00000000-0000-0000-0000-0000000000e4', 'Eva Test', 'TEST-E4', current_date, 'Operaria', 'Producción', 'indefinido', 'activo');
insert into produccion.operarias (empleado_id, categoria, color_avatar) values
  ('00000000-0000-0000-0000-0000000000e4', 'A', '#7c3aed');
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-TEST2', 2000, 2),
  ('00000000-0000-0000-0000-0000000000c3', 'T-TEST3', 2000, 3),
  ('00000000-0000-0000-0000-0000000000c4', 'T-TEST4', 2000, 4),
  ('00000000-0000-0000-0000-0000000000c5', 'T-TEST5', 2000, 5);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, inicio) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar', now()),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d1', 500, 'cola', null),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now()),
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000d1', 10, 'para_envasar', now());
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, inicio) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000f1', 10, 'cola', null),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000f1', 10, 'cola', null),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000f1', 10, 'cola', null),
  ('00000000-0000-0000-0000-000000000306', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000f1', 1, 'cola', null),
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-0000000000f1', 3, 'activo', now());
insert into produccion.fabricacion_mp (id, fabricacion_id, orden, codigo, descripcion, cantidad) values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000202', 1, 'MP-T', 'Agua-test', 500);
insert into produccion.participaciones (entidad, entidad_id, empleado_id) values
  ('fabricacion', '00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-0000000000e1');

-- Planta
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 7. iniciar abre la participación de quien inicia
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'iniciar', '00000000-0000-0000-0000-0000000000e1');
insert into _tap (l) select is(
  (select string_agg(empleado_id::text, ',') from produccion.participaciones
   where entidad_id = '00000000-0000-0000-0000-000000000301' and hasta is null),
  '00000000-0000-0000-0000-0000000000e1', 'iniciar abre la participación de la operaria');

-- 8. sumarse abre la segunda y deja evento sumarse con la operaria
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'sumarse', '00000000-0000-0000-0000-0000000000e2');
insert into _tap (l) select is(
  (select count(*) from produccion.participaciones
   where entidad_id = '00000000-0000-0000-0000-000000000301' and hasta is null) || '/' ||
  (select count(*) from produccion.eventos where entidad_id = '00000000-0000-0000-0000-000000000301'
     and accion = 'sumarse' and empleado_id = '00000000-0000-0000-0000-0000000000e2') || '/' ||
  (select estado from produccion.envasados where id = '00000000-0000-0000-0000-000000000301'),
  '2/1/activo', 'sumarse: 2 abiertas, evento sumarse y el estado no cambia');

-- 9. sumarse dos veces
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'sumarse', '00000000-0000-0000-0000-0000000000e2')->>'codigo',
  'YA_PARTICIPA', 'sumarse dos veces: YA_PARTICIPA');

-- 10. sumarse a una orden en cola
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000303', 'sumarse', '00000000-0000-0000-0000-0000000000e4')->>'codigo',
  'TRANSICION_INVALIDA', 'sumarse en cola: TRANSICION_INVALIDA');

-- 11. sumarse a un envasado estando en otro abierto
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000302', 'iniciar', '00000000-0000-0000-0000-0000000000e4');
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000302', 'sumarse', '00000000-0000-0000-0000-0000000000e1')->>'codigo',
  'OPERARIA_OCUPADA', 'sumarse a envasado estando en otro: OPERARIA_OCUPADA');

-- 11b. un envasado pausado no bloquea: E4 sola en …302 pausado inicia …306; después lo termina y reanuda …302
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000302', 'pausar', '00000000-0000-0000-0000-0000000000e4');
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000306', 'iniciar', '00000000-0000-0000-0000-0000000000e4')->>'estado',
  'activo', 'sola en un envasado pausado puede iniciar otro');
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000306', 'finalizar', '00000000-0000-0000-0000-0000000000e4', null,
  '[{"empleado_id":"00000000-0000-0000-0000-0000000000e4","cantidad":5,"unidad":"L"}]');
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000302', 'reanudar', '00000000-0000-0000-0000-0000000000e4');

-- 12. salir de envasado sin cantidad / con cantidad inválida
insert into _tap (l) select is(
  (produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'salir', '00000000-0000-0000-0000-0000000000e2')->>'codigo') || '/' ||
  (produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'salir', '00000000-0000-0000-0000-0000000000e2', null,
     '[{"empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":120,"unidad":"ml"}]')->>'codigo') || '/' ||
  (produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'salir', '00000000-0000-0000-0000-0000000000e2', null,
     '[{"empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":120,"unidad":"L"}]')->>'codigo'),
  'CANTIDAD_REQUERIDA/CANTIDAD_REQUERIDA/CANTIDAD_REQUERIDA', 'salir de envasado sin cantidad válida propia: CANTIDAD_REQUERIDA');

-- 13. salir con cantidad
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'salir', '00000000-0000-0000-0000-0000000000e2', null,
  '[{"empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":120,"unidad":"L"}]');
insert into _tap (l) select is(
  (select cantidad || '/' || unidad || '/' || (hasta is not null) from produccion.participaciones
   where entidad_id = '00000000-0000-0000-0000-000000000301' and empleado_id = '00000000-0000-0000-0000-0000000000e2') || '/' ||
  (select datos::text from produccion.eventos where entidad_id = '00000000-0000-0000-0000-000000000301'
     and accion = 'salir' and empleado_id = '00000000-0000-0000-0000-0000000000e2'),
  '120/L/true/{"unidad": "L", "cantidad": 120}', 'salir cierra con cantidad y deja evento salir con {cantidad, unidad}');

-- 14. la última no puede salir
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'salir', '00000000-0000-0000-0000-0000000000e1', null,
    '[{"empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":10,"unidad":"L"}]')->>'codigo',
  'ULTIMA_OPERARIA', 'salir siendo la única: ULTIMA_OPERARIA');

-- 15. salir sin participar
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'salir', '00000000-0000-0000-0000-0000000000e2', null,
    '[{"empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":10,"unidad":"L"}]')->>'codigo',
  'NO_PARTICIPA', 'salir sin participar: NO_PARTICIPA');

-- 16. fabricación: salir sin cantidades
select produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000202', 'iniciar', '00000000-0000-0000-0000-0000000000e1');
select produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000202', 'sumarse', '00000000-0000-0000-0000-0000000000e2');
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000202', 'salir',
  '00000000-0000-0000-0000-0000000000e2')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' ||
  (select count(*) from produccion.participaciones where entidad_id = '00000000-0000-0000-0000-000000000202'
     and empleado_id = '00000000-0000-0000-0000-0000000000e2' and hasta is not null and cantidad is null) || '/' ||
  (select datos::text from produccion.eventos where entidad_id = '00000000-0000-0000-0000-000000000202' and accion = 'salir'),
  'true/1/{}', 'salir de fabricación no pide cantidad');

-- 17-18. cargar_mp por participación
select produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000202', 'sumarse', '00000000-0000-0000-0000-0000000000e2');
select set_config('t.r', produccion.cargar_mp('00000000-0000-0000-0000-000000000401', 'L-T', true,
  '00000000-0000-0000-0000-0000000000e2')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' ||
  (select cargado_por::text from produccion.fabricacion_mp where id = '00000000-0000-0000-0000-000000000401'),
  'true/00000000-0000-0000-0000-0000000000e2', 'cargar_mp por la segunda operaria: ok y cargado_por = ella');
insert into _tap (l) select is(
  produccion.cargar_mp('00000000-0000-0000-0000-000000000401', 'L-T', true, '00000000-0000-0000-0000-0000000000e4')->>'codigo',
  'NO_PARTICIPA', 'cargar_mp por una operaria que no participa: NO_PARTICIPA');

-- 19-20. finalizar envasado con 2 abiertas exige ambas cantidades
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'sumarse', '00000000-0000-0000-0000-0000000000e2');
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'finalizar', '00000000-0000-0000-0000-0000000000e1', null,
    '[{"empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":30,"unidad":"L"}]')->>'codigo',
  'CANTIDAD_REQUERIDA', 'finalizar con 2 abiertas y 1 cantidad: CANTIDAD_REQUERIDA');
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000301', 'finalizar', '00000000-0000-0000-0000-0000000000e1', null,
  '[{"empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":30,"unidad":"L"},
    {"empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":20.5,"unidad":"L"}]');
insert into _tap (l) select is(
  (select estado from produccion.envasados where id = '00000000-0000-0000-0000-000000000301') || '/' ||
  (select count(*) filter (where hasta is null) || '/' || count(*) filter (where cantidad is not null)
   from produccion.participaciones where entidad_id = '00000000-0000-0000-0000-000000000301') || '/' ||
  (select jsonb_array_length(datos->'cantidades') from produccion.eventos
   where entidad_id = '00000000-0000-0000-0000-000000000301' and accion = 'finalizar'),
  'finalizado/0/3/2', 'finalizar con 2 cantidades: cierra ambas, finalizado y evento con las cantidades');

-- 21. tras finalizar, el salir de la otra operaria llega tarde
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000302', 'sumarse', '00000000-0000-0000-0000-0000000000e2');
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000302', 'finalizar', '00000000-0000-0000-0000-0000000000e4', null,
  '[{"empleado_id":"00000000-0000-0000-0000-0000000000e4","cantidad":30,"unidad":"L"},
    {"empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":20,"unidad":"L"}]');
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000302', 'salir', '00000000-0000-0000-0000-0000000000e2', null,
    '[{"empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":20,"unidad":"L"}]')->>'codigo',
  'TRANSICION_INVALIDA', 'salir después de que otra finalizó: TRANSICION_INVALIDA');

-- 22. planta pausar sin participar
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000202', 'pausar', '00000000-0000-0000-0000-0000000000e4')->>'codigo',
  'NO_PARTICIPA', 'planta pausar sin participar: NO_PARTICIPA');

-- 23. planta pausar en una orden sin participaciones abiertas: vale y le abre la participación
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000203', 'pausar',
  '00000000-0000-0000-0000-0000000000e4')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'estado') || '/' ||
  (select string_agg(empleado_id::text, ',') from produccion.participaciones
   where entidad_id = '00000000-0000-0000-0000-000000000203' and hasta is null),
  'pausada/00000000-0000-0000-0000-0000000000e4', 'orden sin participaciones: pausa y le abre la participación');

-- Panel
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 24. panel finaliza sin cantidades
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000303', 'iniciar', '00000000-0000-0000-0000-0000000000e1');
select produccion.accion('envasado', '00000000-0000-0000-0000-000000000303', 'sumarse', '00000000-0000-0000-0000-0000000000e2');
select set_config('t.r', produccion.accion('envasado', '00000000-0000-0000-0000-000000000303', 'finalizar')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' ||
  (select count(*) filter (where hasta is not null and cantidad is null) || '/' || count(*)
   from produccion.participaciones where entidad_id = '00000000-0000-0000-0000-000000000303'),
  'true/2/2', 'panel finaliza sin cantidades: participaciones cerradas con cantidad null');

-- 25. cancelar cierra todas
select produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000202', 'cancelar');
insert into _tap (l) select is(
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-000000000202') || '/' ||
  (select count(*) from produccion.participaciones
   where entidad_id = '00000000-0000-0000-0000-000000000202' and hasta is null),
  'cancelada/0', 'cancelar cierra todas las participaciones');

-- 26. cierre automático de la fabricación: cierra sus participaciones
select set_config('t.r', produccion.accion('envasado', '00000000-0000-0000-0000-000000000305', 'finalizar')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'fabricacion_cerrada') || '/' ||
  (select count(*) from produccion.participaciones
   where entidad = 'fabricacion' and entidad_id = '00000000-0000-0000-0000-000000000204' and hasta is null),
  'true/0', 'cierre automático de la fabricación: 0 participaciones abiertas');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
