-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(19);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres): tanques T-TEST2..4 vacíos; producto Bactipro-test (d2) sin código.
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-TEST2', 2000, 2),
  ('00000000-0000-0000-0000-0000000000c3', 'T-TEST3', 2000, 3),
  ('00000000-0000-0000-0000-0000000000c4', 'T-TEST4', 2000, 4);
insert into produccion.productos (id, nombre, color, tipo) values
  ('00000000-0000-0000-0000-0000000000d2', 'Bactipro-test', '#65a30d', 'liquido');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 1-4. el panel crea una orden con 2 MP
select set_config('t.r', produccion.crear_fabricacion_formula(
  '{"tanque_id":"00000000-0000-0000-0000-0000000000c1","producto_id":"00000000-0000-0000-0000-0000000000d1",
    "litros":1000,"lote":"17702","vencimiento":"2028-10-21","fecha_formula":"2026-10-21",
    "operaria_id":"00000000-0000-0000-0000-0000000000e1","codigo_producto":"F8"}',
  '[{"codigo":"MP-A","descripcion":"Agua","cantidad":967},{"codigo":"MP-B","descripcion":"Perfume","cantidad":0.4}]'
)::text, true);
select set_config('t.f1', current_setting('t.r')::jsonb->>'id', true);
insert into _tap (l) select is((current_setting('t.r')::jsonb->>'ok')::boolean, true, 'panel crea la orden desde la fórmula');
insert into _tap (l) select is(
  (select string_agg(m.orden || ':' || m.codigo || ':' || m.cantidad, ',' order by m.orden)
   from produccion.fabricacion_mp m where m.fabricacion_id = current_setting('t.f1')::uuid),
  '1:MP-A:967,2:MP-B:0.4', 'MP guardadas con orden = posición en el array');
insert into _tap (l) select is(
  (select vencimiento || '/' || fecha_formula || '/' || estado || '/' || lote
   from produccion.fabricaciones where id = current_setting('t.f1')::uuid),
  '2028-10-21/2026-10-21/cola/17702', 'vencimiento y fecha de fórmula guardados, en cola');
insert into _tap (l) select is(
  (select codigo from produccion.productos where id = '00000000-0000-0000-0000-0000000000d1'),
  'F8', 'el producto sin código adopta el de la fórmula');

-- 5. mismo lote en otro tanque
insert into _tap (l) select is(
  produccion.crear_fabricacion_formula(
    '{"tanque_id":"00000000-0000-0000-0000-0000000000c2","producto_id":"00000000-0000-0000-0000-0000000000d1",
      "litros":500,"lote":" 17702 "}', '[]')->>'codigo',
  'LOTE_DUPLICADO', 'lote repetido en una fabricación no cancelada');

-- 6. código ya usado por otro producto: se crea igual y no se toca ningún código
select set_config('t.r', produccion.crear_fabricacion_formula(
  '{"tanque_id":"00000000-0000-0000-0000-0000000000c2","producto_id":"00000000-0000-0000-0000-0000000000d2",
    "litros":500,"lote":"17703","operaria_id":"00000000-0000-0000-0000-0000000000e1","codigo_producto":"F8"}',
  '[{"codigo":"MP-C","descripcion":"Base","cantidad":500}]'
)::text, true);
select set_config('t.f2', current_setting('t.r')::jsonb->>'id', true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' ||
  (select codigo from produccion.productos where id = '00000000-0000-0000-0000-0000000000d1') || '/' ||
  coalesce((select codigo from produccion.productos where id = '00000000-0000-0000-0000-0000000000d2'), 'null'),
  'true/F8/null', 'código ya usado por otro producto: ok y no cambia nada');

-- 7. tanque con fabricación abierta
insert into _tap (l) select is(
  produccion.crear_fabricacion_formula(
    '{"tanque_id":"00000000-0000-0000-0000-0000000000c1","producto_id":"00000000-0000-0000-0000-0000000000d1",
      "litros":500,"lote":"17704"}', '[]')->>'codigo',
  'TANQUE_OCUPADO', 'tanque ocupado');

-- el panel inicia la orden 1 (queda con la operaria de la fórmula, E1)
select produccion.accion('fabricacion', current_setting('t.f1')::uuid, 'iniciar');
select set_config('t.mp1', (select id::text from produccion.fabricacion_mp
  where fabricacion_id = current_setting('t.f1')::uuid and orden = 1), true);
select set_config('t.mp2', (select id::text from produccion.fabricacion_mp
  where fabricacion_id = current_setting('t.f1')::uuid and orden = 2), true);
select set_config('t.mp3', (select id::text from produccion.fabricacion_mp
  where fabricacion_id = current_setting('t.f2')::uuid and orden = 1), true);

-- orden 3 sin operaria, iniciada desde el panel (operaria_id queda null)
select set_config('t.f3', produccion.crear_fabricacion_formula(
  '{"tanque_id":"00000000-0000-0000-0000-0000000000c4","producto_id":"00000000-0000-0000-0000-0000000000d1",
    "litros":200,"lote":"17706"}',
  '[{"codigo":"MP-D","descripcion":"Agua","cantidad":200}]')->>'id', true);
select produccion.accion('fabricacion', current_setting('t.f3')::uuid, 'iniciar');
select set_config('t.mp4', (select id::text from produccion.fabricacion_mp
  where fabricacion_id = current_setting('t.f3')::uuid and orden = 1), true);

-- tablet
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 8. la tablet no crea órdenes
insert into _tap (l) select is(
  produccion.crear_fabricacion_formula(
    '{"tanque_id":"00000000-0000-0000-0000-0000000000c3","producto_id":"00000000-0000-0000-0000-0000000000d1",
      "litros":500,"lote":"17705"}', '[]')->>'codigo',
  'NO_AUTORIZADO', 'la tablet no puede crear órdenes');

-- 9-11. cargar_mp rechazos
insert into _tap (l) select is(
  produccion.cargar_mp(current_setting('t.mp1')::uuid, 'L-1', true, '00000000-0000-0000-0000-0000000000e1', '9999')->>'codigo',
  'PIN_INCORRECTO', 'cargar_mp con PIN incorrecto');
insert into _tap (l) select is(
  produccion.cargar_mp(current_setting('t.mp1')::uuid, 'L-1', true, '00000000-0000-0000-0000-0000000000e2', '1234')->>'codigo',
  'NO_AUTORIZADO', 'cargar_mp con una operaria que no es la de la fabricación');
insert into _tap (l) select is(
  produccion.cargar_mp(current_setting('t.mp3')::uuid, 'L-1', true, '00000000-0000-0000-0000-0000000000e1', '1234')->>'codigo',
  'TRANSICION_INVALIDA', 'cargar_mp en una fabricación en cola');

-- 11b. fabricación sin operaria asignada: cualquier operaria activa con PIN carga, a su nombre
select set_config('t.r', produccion.cargar_mp(current_setting('t.mp4')::uuid, 'L-77', true,
  '00000000-0000-0000-0000-0000000000e2', '1234')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' ||
  (select lote || '/' || cargado_por from produccion.fabricacion_mp where id = current_setting('t.mp4')::uuid),
  'true/L-77/00000000-0000-0000-0000-0000000000e2', 'sin operaria asignada: carga quien pone su PIN');

-- 12. carga OK (recorta el lote)
select produccion.cargar_mp(current_setting('t.mp1')::uuid, ' L-55 ', true, '00000000-0000-0000-0000-0000000000e1', '1234');
insert into _tap (l) select is(
  (select lote || '/' || pesado || '/' || cargado_por || '/' || (cargado_at is not null)
   from produccion.fabricacion_mp where id = current_setting('t.mp1')::uuid),
  'L-55/true/00000000-0000-0000-0000-0000000000e1/true', 'cargar_mp guarda lote recortado, pesado y quién');

-- 13. v_tareas expone el avance
insert into _tap (l) select is(
  (select mp_total || '/' || mp_completas from produccion.v_tareas
   where entidad = 'fabricacion' and id = current_setting('t.f1')::uuid),
  '2/1', 'v_tareas: mp_total 2, mp_completas 1');

-- 14. finalizar con 1 MP incompleta
select set_config('t.r', produccion.accion('fabricacion', current_setting('t.f1')::uuid, 'finalizar',
  '00000000-0000-0000-0000-0000000000e1', '1234')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' || (current_setting('t.r')::jsonb->>'codigo') || '/' ||
  (current_setting('t.r')::jsonb->>'detalle') || '/' ||
  (select estado from produccion.fabricaciones where id = current_setting('t.f1')::uuid),
  'false/MP_INCOMPLETA/1/fabricando', 'finalizar bloqueado con 1 MP incompleta');

-- 15. lote en blanco cuenta como incompleta (escrito directo, como postgres)
reset role;
update produccion.fabricacion_mp set lote = '   ', pesado = true where id = current_setting('t.mp2')::uuid;
set local role authenticated;
insert into _tap (l) select is(
  produccion.accion('fabricacion', current_setting('t.f1')::uuid, 'finalizar',
    '00000000-0000-0000-0000-0000000000e1', '1234')->>'detalle',
  '1', 'lote en blanco cuenta como incompleta');

-- 16. el panel completa la MP sin PIN; cargado_por = operaria de la fabricación
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.r', produccion.cargar_mp(current_setting('t.mp2')::uuid, 'L-56', true)::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' ||
  (select lote || '/' || cargado_por from produccion.fabricacion_mp where id = current_setting('t.mp2')::uuid),
  'true/L-56/00000000-0000-0000-0000-0000000000e1', 'el panel carga sin PIN a nombre de la operaria asignada');

-- 17. todas completas: finaliza
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('t.r', produccion.accion('fabricacion', current_setting('t.f1')::uuid, 'finalizar',
  '00000000-0000-0000-0000-0000000000e1', '1234')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' ||
  (select estado from produccion.fabricaciones where id = current_setting('t.f1')::uuid),
  'true/para_envasar', 'con todas las MP completas finaliza');

-- 18. fabricación sin MP (manual) finaliza normal
reset role;
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, operaria_id, inicio) values
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d1',
   300, 'fabricando', '00000000-0000-0000-0000-0000000000e1', now());
set local role authenticated;
insert into _tap (l) select is(
  (produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b9', 'finalizar',
    '00000000-0000-0000-0000-0000000000e1', '1234')->>'estado'),
  'para_envasar', 'fabricación sin MP finaliza normal');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
