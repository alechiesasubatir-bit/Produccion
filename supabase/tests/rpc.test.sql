-- Ejecutar: begin; + _fixtures.sql + este archivo.
-- accion() no lanza errores de negocio: devuelve {ok:false, codigo, detalle} (ver migración 003).
insert into _tap (l) select plan(12);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres) -------------------------------------------------
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-02', 2000, 2),
  ('00000000-0000-0000-0000-0000000000c3', 'T-03', 2000, 3),
  ('00000000-0000-0000-0000-0000000000c4', 'T-04', 2000, 4),
  ('00000000-0000-0000-0000-0000000000c5', 'T-05', 2000, 5),
  ('00000000-0000-0000-0000-0000000000c6', 'T-06', 2000, 6),
  ('00000000-0000-0000-0000-0000000000c7', 'T-07', 2000, 7);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, operaria_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 1000, 'cola', null),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 1000, 'cola', null),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d1', 1000, 'cola', null),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000d1', 1000, 'fabricando', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000d1', 1000, 'fabricando', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000d1', 10, 'para_envasar', '00000000-0000-0000-0000-0000000000e2');
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, operaria_1) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000f1', 10, 'cola', null),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000f1', 10, 'cola', null),
  ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000f1', 10, 'cola', null),
  ('00000000-0000-0000-0000-0000000000ac', '00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000f1', 3, 'activo', '00000000-0000-0000-0000-0000000000e2');

-- Como tablet ---------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 1. iniciar
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'iniciar',
  '00000000-0000-0000-0000-0000000000e1', '1234')::text, true);
insert into _tap (l) select is(
  (select f.estado || '/' || f.operaria_id || '/' || (select count(*) from produccion.eventos e where e.entidad_id = f.id)
   from produccion.fabricaciones f where f.id = '00000000-0000-0000-0000-0000000000b1'),
  'fabricando/00000000-0000-0000-0000-0000000000e1/1',
  'iniciar: fabricando, operaria asignada y 1 evento');

-- 2. transición inválida
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b2', 'finalizar',
    '00000000-0000-0000-0000-0000000000e1', '1234')->>'codigo',
  'TRANSICION_INVALIDA', 'finalizar desde cola es inválido');

-- 3. PIN incorrecto suma un intento (y persiste)
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'pausar',
  '00000000-0000-0000-0000-0000000000e1', '9999')::text, true);
reset role;
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'codigo') || '/' ||
  (select pin_intentos from produccion.operarias where empleado_id = '00000000-0000-0000-0000-0000000000e1'),
  'PIN_INCORRECTO/1', 'PIN incorrecto: código y pin_intentos = 1');
set local role authenticated;

-- 4. acierto después de errores reinicia el contador
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'pausar',
  '00000000-0000-0000-0000-0000000000e1', '1234')::text, true);
reset role;
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'estado') || '/' ||
  (select pin_intentos from produccion.operarias where empleado_id = '00000000-0000-0000-0000-0000000000e1'),
  'pausada/0', 'PIN correcto tras un error: pausada y pin_intentos = 0');
set local role authenticated;

-- 5. operaria dada de baja en core
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b3', 'iniciar',
    '00000000-0000-0000-0000-0000000000e3', '1234')->>'codigo',
  'OPERARIA_INACTIVA', 'operaria inactiva rechazada');

-- 6. cancelar: tablet no, panel sí (sin PIN)
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b3', 'cancelar',
  '00000000-0000-0000-0000-0000000000e1', '1234')::text, true);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'codigo') || '/' ||
  (produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b3', 'cancelar')->>'estado'),
  'NO_AUTORIZADO/cancelada', 'tablet no cancela; panel cancela sin PIN');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 7. doble finalización: la segunda ve quién lo hizo
select produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b4', 'finalizar',
  '00000000-0000-0000-0000-0000000000e1', '1234');
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b4', 'finalizar',
  '00000000-0000-0000-0000-0000000000e2', '1234')::text, true);
insert into _tap (l) select ok(
  current_setting('t.r')::jsonb->>'codigo' = 'TRANSICION_INVALIDA'
  and current_setting('t.r')::jsonb->>'detalle' like 'ya la finalizó Laura Paz a las __:__',
  'segunda finalización: TRANSICION_INVALIDA con "ya la finalizó Laura Paz a las HH:MM"');

-- 8. envasar con el tanque todavía fabricando
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000a0', 'iniciar',
    '00000000-0000-0000-0000-0000000000e1', '1234')->>'codigo',
  'TANQUE_NO_LISTO', 'envasado no inicia si la fabricación no está para_envasar');

-- 9. operaria ya envasando
select produccion.accion('envasado', '00000000-0000-0000-0000-0000000000aa', 'iniciar',
  '00000000-0000-0000-0000-0000000000e1', '1234');
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000ab', 'iniciar',
    '00000000-0000-0000-0000-0000000000e1', '1234')->>'codigo',
  'OPERARIA_OCUPADA', 'una operaria no puede estar en dos envasados activos');

-- 10. sobre-envasado cierra la fabricación (10 L, 3 × 5L)
select set_config('t.r', produccion.accion('envasado', '00000000-0000-0000-0000-0000000000ac', 'finalizar',
  '00000000-0000-0000-0000-0000000000e2', '1234')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'fabricacion_cerrada') || '/' ||
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-0000000000b7'),
  'true/finalizada', 'envasar más de lo fabricado cierra la fabricación');

-- 11. bloqueo: 5 PINs incorrectos, después ni el correcto entra
select produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'reanudar', '00000000-0000-0000-0000-0000000000e2', '9999')
from generate_series(1, 5);
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'reanudar',
    '00000000-0000-0000-0000-0000000000e2', '1234')->>'codigo',
  'PIN_BLOQUEADO', '5 errores bloquean aunque el PIN siguiente sea correcto');

-- 12. usuario sin rol de producción
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'reanudar')->>'codigo',
  'NO_AUTORIZADO', 'usuario sin rol no puede accionar');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
