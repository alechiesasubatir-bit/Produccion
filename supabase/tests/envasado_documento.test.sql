-- Ejecutar: begin; + 017 + _fixtures.sql + este archivo.
-- Envasados sin tanque, consumibles y granel de stock (migración 017, sección 1 y accion()).
insert into _tap (l) select plan(65);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- 1-2. envasado esperando fabricación: vale con granel, no vale sin nada
insert into _tap (l) select lives_ok(
  $$insert into produccion.envasados (id, fabricacion_id, granel_id, presentacion_id, cantidad, estado)
    values ('00000000-0000-0000-0000-0000000000b2', null, '00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000f1', 5, 'cola')$$,
  'envasado con fabricacion_id null y granel_id: ok');
insert into _tap (l) select throws_ok(
  $$insert into produccion.envasados (fabricacion_id, granel_id, presentacion_id, cantidad)
    values (null, null, '00000000-0000-0000-0000-0000000000f1', 5)$$,
  '23514', null, 'envasado sin fabricación ni granel: falla envasados_origen_ck');

-- 3-4. no se inicia ni se suma a un envasado sin tanque
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000b2', 'iniciar',
    '00000000-0000-0000-0000-0000000000e1')->>'codigo',
  'SIN_TANQUE', 'iniciar un envasado sin fabricación: SIN_TANQUE');
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000b2', 'sumarse',
    '00000000-0000-0000-0000-0000000000e1')->>'codigo',
  'SIN_TANQUE', 'sumarse a un envasado sin fabricación: SIN_TANQUE');

-- 5. la planta no crea granel de stock
insert into _tap (l) select is(
  produccion.crear_granel_stock('00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1', 1000, 'L-STK-0')->>'codigo',
  'NO_AUTORIZADO', 'crear_granel_stock desde planta: NO_AUTORIZADO');

-- 6-9. el panel crea granel de stock
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- el panel cancela un envasado que espera fabricación (sin tanque)
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000b2', 'cancelar')->>'estado',
  'cancelado', 'cancelar un envasado esperando fabricación: cancelado');
insert into _tap (l) select is(
  (select estado from produccion.envasados where id = '00000000-0000-0000-0000-0000000000b2'),
  'cancelado', 'el envasado esperando queda cancelado');
insert into _tap (l) select is(
  produccion.crear_granel_stock('00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1', 1000, 'L-STK-1')->>'ok',
  'true', 'crear_granel_stock desde el panel: ok');
reset role;
insert into _tap (l) select is(
  (select estado || '/' || origen from produccion.fabricaciones where lote = 'L-STK-1'),
  'para_envasar/stock', 'el granel de stock nace para_envasar con origen stock');
insert into _tap (l) select ok(
  (select inicio is not null and inicio = fin from produccion.fabricaciones where lote = 'L-STK-1'),
  'inicio = fin = now()');
insert into _tap (l) select is(
  (select count(*)::int from produccion.eventos e
   join produccion.fabricaciones f on f.id = e.entidad_id
   where e.entidad = 'fabricacion' and e.accion = 'crear' and f.lote = 'L-STK-1'),
  1, 'un solo evento crear (lo registra el trigger)');

-- 10-12. tanque ocupado y datos inválidos
set local role authenticated;
insert into _tap (l) select is(
  produccion.crear_granel_stock('00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1', 500, 'L-STK-2')->>'codigo',
  'TANQUE_OCUPADO', 'granel de stock en un tanque ocupado: TANQUE_OCUPADO');
insert into _tap (l) select is(
  produccion.crear_granel_stock('00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1', 0, 'L-STK-3')->>'codigo',
  'DATOS_INVALIDOS', 'granel de stock con 0 litros: DATOS_INVALIDOS');
insert into _tap (l) select is(
  produccion.crear_granel_stock('00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1', 2001, 'L-STK-4')->>'codigo',
  'DATOS_INVALIDOS', 'granel de stock sobre la capacidad: DATOS_INVALIDOS');

-- 13-15. un envasado sobre la fabricación de stock se inicia y al finalizar la cierra
reset role;
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado)
select '00000000-0000-0000-0000-0000000000b3', f.id, '00000000-0000-0000-0000-0000000000f1', 200, 'cola'
from produccion.fabricaciones f where f.lote = 'L-STK-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000b3', 'iniciar',
    '00000000-0000-0000-0000-0000000000e1')->>'estado',
  'activo', 'el envasado sobre granel de stock se inicia');
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-0000000000b3', 'finalizar',
    '00000000-0000-0000-0000-0000000000e1',
    null, '[{"empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":200,"unidad":"L"}]'::jsonb
  )->>'fabricacion_cerrada',
  'true', 'al finalizar el envasado se cierra la fabricación de stock');
reset role;
insert into _tap (l) select is(
  (select estado from produccion.fabricaciones where lote = 'L-STK-1'),
  'finalizada', 'la fabricación de stock quedó finalizada');

-- 16-17. v_tiempos_estandar ignora el granel de stock
insert into produccion.productos (id, nombre, color, tipo) values
  ('00000000-0000-0000-0000-0000000000d2', 'Estandar-test', '#000000', 'liquido');
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, origen, inicio, fin) values
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000d2', 600, 'finalizada', 'formula', null, null),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000d2', 1000, 'finalizada', 'stock', null, null);
insert into produccion.eventos (entidad, entidad_id, accion, at) values
  ('fabricacion', '00000000-0000-0000-0000-0000000000b5', 'iniciar',   '2026-01-06 08:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-0000000000b5', 'finalizar', '2026-01-06 09:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-0000000000b6', 'iniciar',   '2026-01-06 10:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-0000000000b6', 'finalizar', '2026-01-06 10:10-03');
insert into _tap (l) select is(
  (select muestras from produccion.v_tiempos_estandar where entidad = 'fabricacion' and clave = 'Estandar-test'),
  1, 'estándar: la fabricación de stock no cuenta como muestra');
insert into _tap (l) select is(
  (select velocidad from produccion.v_tiempos_estandar where entidad = 'fabricacion' and clave = 'Estandar-test'),
  10::numeric, 'estándar: la velocidad es solo la de la fabricación de fórmula');

-- 18-20. consumibles: RLS, lectura de planta y sin escritura directa
insert into produccion.consumibles (entidad, entidad_id, orden, codigo, descripcion, cantidad) values
  ('envasado', '00000000-0000-0000-0000-0000000000b3', 1, '900001', 'Envase test', 200);
insert into _tap (l) select ok(
  (select relrowsecurity from pg_class where oid = 'produccion.consumibles'::regclass), 'consumibles tiene RLS');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is((select count(*)::int from produccion.consumibles), 1, 'planta lee consumibles');
insert into _tap (l) select throws_ok(
  $$insert into produccion.consumibles (entidad, entidad_id, orden, codigo, descripcion, cantidad)
    values ('envasado', '00000000-0000-0000-0000-0000000000b3', 2, '900002', 'Tapa test', 200)$$,
  '42501', null, 'planta no inserta consumibles directo');
reset role;

-- Fixtures de 21-50: tanques, otro granel, fabricaciones abiertas y una finalizada
create temp table _ids (k text primary key, v uuid);
grant all on pg_temp._ids to public;
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-DOC1', 2000, 2),
  ('00000000-0000-0000-0000-0000000000c3', 'T-DOC2', 2000, 3),
  ('00000000-0000-0000-0000-0000000000c4', 'T-DOC3', 2000, 4);
insert into produccion.productos (id, nombre, color, tipo) values
  ('00000000-0000-0000-0000-0000000000d3', 'Otro-granel-test', '#000000', 'liquido');
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, lote) values
  ('00000000-0000-0000-0000-000000000b10', '00000000-0000-0000-0000-0000000000c2',
   '00000000-0000-0000-0000-0000000000d1', 500, 'para_envasar', 'L-F1'),
  ('00000000-0000-0000-0000-000000000b11', '00000000-0000-0000-0000-0000000000c3',
   '00000000-0000-0000-0000-0000000000d3', 500, 'para_envasar', 'L-F2'),
  ('00000000-0000-0000-0000-000000000b12', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000d1', 500, 'finalizada', 'L-F3'),
  ('00000000-0000-0000-0000-000000000b13', '00000000-0000-0000-0000-0000000000c4',
   '00000000-0000-0000-0000-0000000000d1', 500, 'para_envasar', 'L-F4');

-- 21-25. crear documento desde el panel
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _ids select 'env1', (produccion.crear_envasado_documento(
  '{"fabricacion_id":"00000000-0000-0000-0000-000000000b10","granel_id":"00000000-0000-0000-0000-0000000000d1","presentacion_id":"00000000-0000-0000-0000-0000000000f1","cantidad":630,"lote":"L-DOC-1","codigo":"200001","descripcion":"Lavandina 5L doc","litros_granel":500}'::jsonb,
  '[{"codigo":"100001","descripcion":"Envase 5L test","cantidad":630},{"codigo":"100002","descripcion":"Tapa test","cantidad":630},{"codigo":"100003","descripcion":"Etiqueta test","cantidad":630}]'::jsonb
)->>'id')::uuid;
insert into _tap (l) select ok((select v from _ids where k = 'env1') is not null, 'crear_envasado_documento desde el panel: ok');
insert into _tap (l) select is(
  (select fabricacion_id::text || '/' || lote || '/' || codigo || '/' || cantidad || '/' || litros_granel
   from produccion.envasados where id = (select v from _ids where k = 'env1')),
  '00000000-0000-0000-0000-000000000b10/L-DOC-1/200001/630/500', 'el envasado guarda fabricación, lote, código, cantidad y litros');
insert into _tap (l) select is(
  (select string_agg(codigo, ',' order by orden) from produccion.consumibles
   where entidad = 'envasado' and entidad_id = (select v from _ids where k = 'env1')),
  '100001,100002,100003', '3 consumibles en el orden del documento');
insert into _tap (l) select is(
  produccion.crear_envasado_documento(
    '{"fabricacion_id":"00000000-0000-0000-0000-000000000b10","granel_id":"00000000-0000-0000-0000-0000000000d1","presentacion_id":"00000000-0000-0000-0000-0000000000f1","cantidad":10,"lote":"L-DOC-0"}'::jsonb,
    '[{"codigo":"100001","descripcion":"Envase test","cantidad":10},{"codigo":"100002","descripcion":"Tapa test","cantidad":0}]'::jsonb
  )->>'codigo', 'DATOS_INVALIDOS', 'consumible con cantidad 0: DATOS_INVALIDOS');
insert into _tap (l) select is(
  (select count(*)::int from produccion.envasados where lote = 'L-DOC-0'), 0, 'consumible inválido: no se crea nada');

-- 26-27. fabricación de otro granel y fabricación cerrada
insert into _tap (l) select is(
  produccion.crear_envasado_documento(
    '{"fabricacion_id":"00000000-0000-0000-0000-000000000b11","granel_id":"00000000-0000-0000-0000-0000000000d1","presentacion_id":"00000000-0000-0000-0000-0000000000f1","cantidad":10}'::jsonb
  )->>'codigo', 'GRANEL_DISTINTO', 'fabricación de otro granel: GRANEL_DISTINTO');
insert into _tap (l) select is(
  produccion.crear_envasado_documento(
    '{"fabricacion_id":"00000000-0000-0000-0000-000000000b12","granel_id":"00000000-0000-0000-0000-0000000000d1","presentacion_id":"00000000-0000-0000-0000-0000000000f1","cantidad":10}'::jsonb
  )->>'codigo', 'TRANSICION_INVALIDA', 'fabricación finalizada: TRANSICION_INVALIDA');

-- 28-29. esperando fabricación: ok y no aparece en v_tareas
insert into _ids select 'env2', (produccion.crear_envasado_documento(
  '{"fabricacion_id":null,"granel_id":"00000000-0000-0000-0000-0000000000d1","presentacion_id":"00000000-0000-0000-0000-0000000000f1","cantidad":4,"lote":"L-DOC-2"}'::jsonb
)->>'id')::uuid;
insert into _tap (l) select ok(
  (select fabricacion_id is null and granel_id is not null from produccion.envasados
   where id = (select v from _ids where k = 'env2')), 'envasado esperando fabricación: ok');
insert into _tap (l) select is(
  (select count(*)::int from produccion.v_tareas where id = (select v from _ids where k = 'env2')),
  0, 'el envasado sin tanque no aparece en v_tareas');

-- 30-31. fraccionado desde documento
insert into _ids select 'frac1', (produccion.crear_fraccionado_documento(
  '{"producto_id":null,"presentacion_id":null,"cantidad":50,"lote":"L-FRAC-1","codigo":"300001","descripcion":"Polvo test 1kg"}'::jsonb,
  '[{"codigo":"100010","descripcion":"Pote test","cantidad":50}]'::jsonb
)->>'id')::uuid;
insert into _tap (l) select ok((select v from _ids where k = 'frac1') is not null, 'crear_fraccionado_documento: ok');
insert into _tap (l) select is(
  (select tipo || '/' || codigo || '/' || cantidad || '/' || (select count(*) from produccion.consumibles c
     where c.entidad = 'fraccionado' and c.entidad_id = x.id)
   from produccion.fraccionados x where x.id = (select v from _ids where k = 'frac1')),
  'polvo/300001/50/1', 'el fraccionado es de polvo, con código y su consumible');

-- 32. la planta no crea documentos
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.crear_envasado_documento(
    '{"granel_id":"00000000-0000-0000-0000-0000000000d1","presentacion_id":"00000000-0000-0000-0000-0000000000f1","cantidad":10}'::jsonb
  )->>'codigo', 'NO_AUTORIZADO', 'crear_envasado_documento desde planta: NO_AUTORIZADO');

-- 33-38. cargar_consumible desde planta
insert into _tap (l) select is(
  produccion.cargar_consumible(
    (select id from produccion.consumibles where entidad_id = (select v from _ids where k = 'env1') and orden = 1),
    'LC-1', '00000000-0000-0000-0000-0000000000e1')->>'codigo',
  'TRANSICION_INVALIDA', 'cargar_consumible en un envasado en cola: TRANSICION_INVALIDA');
insert into _tap (l) select is(
  produccion.accion('envasado', (select v from _ids where k = 'env1'), 'iniciar',
    '00000000-0000-0000-0000-0000000000e1')->>'estado',
  'activo', 'el envasado del documento se inicia');
insert into _tap (l) select is(
  produccion.cargar_consumible(
    (select id from produccion.consumibles where entidad_id = (select v from _ids where k = 'env1') and orden = 1),
    'LC-1', '00000000-0000-0000-0000-0000000000e1')->>'ok',
  'true', 'cargar_consumible por la operaria que participa: ok');
insert into _tap (l) select is(
  (select lote || '/' || cargado_por::text from produccion.consumibles
   where entidad_id = (select v from _ids where k = 'env1') and orden = 1),
  'LC-1/00000000-0000-0000-0000-0000000000e1', 'el consumible guarda lote y cargado_por');
insert into _tap (l) select is(
  produccion.cargar_consumible(
    (select id from produccion.consumibles where entidad_id = (select v from _ids where k = 'env1') and orden = 2),
    'LC-2', '00000000-0000-0000-0000-0000000000e2')->>'codigo',
  'NO_PARTICIPA', 'cargar_consumible por quien no participa: NO_PARTICIPA');
select produccion.cargar_consumible(
  (select id from produccion.consumibles where entidad_id = (select v from _ids where k = 'env1') and orden = 2),
  'LC-2', '00000000-0000-0000-0000-0000000000e1');
select produccion.cargar_consumible(
  (select id from produccion.consumibles where entidad_id = (select v from _ids where k = 'env1') and orden = 2),
  '   ', '00000000-0000-0000-0000-0000000000e1');
insert into _tap (l) select ok(
  (select lote is null from produccion.consumibles
   where entidad_id = (select v from _ids where k = 'env1') and orden = 2),
  'lote vacío en cargar_consumible: guarda null');
insert into _tap (l) select ok(
  (select cargado_por is null and cargado_at is null from produccion.consumibles
   where entidad_id = (select v from _ids where k = 'env1') and orden = 2),
  'lote vacío en cargar_consumible: no deja quién ni cuándo');

-- 39-40. editar la cantidad con el envasado activo
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select lives_ok(
  $$update produccion.envasados set cantidad = 7 where id = (select v from _ids where k = 'env1')$$,
  'editar la cantidad de un envasado activo: ok');
reset role;
insert into _tap (l) select is(
  (select count(*)::int from produccion.eventos
   where entidad = 'envasado' and entidad_id = (select v from _ids where k = 'env1') and accion = 'editar'),
  1, 'la edición deja un evento editar');

-- 41. el tanque no se cambia con el envasado en curso
set local role authenticated;
insert into _tap (l) select throws_ok(
  $$update produccion.envasados set fabricacion_id = '00000000-0000-0000-0000-000000000b13'
    where id = (select v from _ids where k = 'env1')$$,
  'PC001', 'TANQUE_EN_USO', 'cambiar el tanque de un envasado activo: TANQUE_EN_USO');

-- 42-43. asignar tanque a un envasado esperando
insert into _tap (l) select lives_ok(
  $$update produccion.envasados set fabricacion_id = '00000000-0000-0000-0000-000000000b10'
    where id = (select v from _ids where k = 'env2')$$,
  'asignar tanque a un envasado esperando: ok');
insert into _tap (l) select is(
  (select count(*)::int from produccion.v_tareas where id = (select v from _ids where k = 'env2')),
  1, 'con tanque aparece en v_tareas');

-- 44-46. destinos inválidos
insert into _ids select 'env3', (produccion.crear_envasado_documento(
  '{"granel_id":"00000000-0000-0000-0000-0000000000d1","presentacion_id":"00000000-0000-0000-0000-0000000000f1","cantidad":3,"lote":"L-DOC-3"}'::jsonb
)->>'id')::uuid;
insert into _tap (l) select throws_ok(
  $$update produccion.envasados set fabricacion_id = '00000000-0000-0000-0000-000000000b11'
    where id = (select v from _ids where k = 'env3')$$,
  'PC001', 'GRANEL_DISTINTO', 'asignar una fabricación de otro granel: GRANEL_DISTINTO');
insert into _tap (l) select throws_ok(
  $$update produccion.envasados set fabricacion_id = '00000000-0000-0000-0000-000000000b12'
    where id = (select v from _ids where k = 'env3')$$,
  'PC001', 'TRANSICION_INVALIDA', 'asignar una fabricación cerrada: TRANSICION_INVALIDA');
insert into _tap (l) select throws_ok(
  $$update produccion.envasados set fabricacion_id = null
    where id = (select v from _ids where k = 'env2')$$,
  'PC001', 'SIN_TANQUE', 'quitar el tanque a un envasado: SIN_TANQUE');

-- 47-48. Review Focus 2: mover el único envasado de una fabricación la deja huérfana (sigue para_envasar)
reset role;
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado) values
  ('00000000-0000-0000-0000-000000000b14', '00000000-0000-0000-0000-000000000b13',
   '00000000-0000-0000-0000-0000000000f1', 1, 'cola');
set local role authenticated;
insert into _tap (l) select lives_ok(
  $$update produccion.envasados set fabricacion_id = '00000000-0000-0000-0000-000000000b10'
    where id = '00000000-0000-0000-0000-000000000b14'$$,
  'mover un envasado en cola a otra fabricación del mismo granel: ok');
reset role;
insert into _tap (l) select is(
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-000000000b13'),
  'para_envasar', 'la fabricación vieja sigue para_envasar (la finaliza la encargada con merma)');

-- 49. finalizar sin lotes de consumibles cargados es válido
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('envasado', (select v from _ids where k = 'env1'), 'finalizar',
    '00000000-0000-0000-0000-0000000000e1', null,
    '[{"empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":35,"unidad":"L"}]'::jsonb)->>'estado',
  'finalizado', 'finalizar con consumibles sin lote: ok');

-- 50. cerrado no se edita
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select throws_ok(
  $$update produccion.envasados set cantidad = 9 where id = (select v from _ids where k = 'env1')$$,
  'PC001', 'NO_EDITABLE', 'editar la cantidad de un envasado finalizado: NO_EDITABLE');
reset role;

-- 51-60. Vistas: envasados del documento y consumibles
insert into produccion.envasados (id, fabricacion_id, granel_id, presentacion_id, cantidad, lote, descripcion, estado) values
  ('00000000-0000-0000-0000-000000000b20', '00000000-0000-0000-0000-000000000b10',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 7, 'L-DOC-4', 'Desc vistas', 'cola');
insert into produccion.consumibles (entidad, entidad_id, orden, codigo, descripcion, cantidad) values
  ('envasado', '00000000-0000-0000-0000-000000000b20', 1, '110001', 'Envase vistas', 7),
  ('envasado', '00000000-0000-0000-0000-000000000b20', 2, '110002', 'Tapa vistas', 7),
  ('envasado', '00000000-0000-0000-0000-000000000b20', 3, '110003', 'Etiqueta vistas', 7);
update produccion.consumibles set lote = 'LC-1', cargado_por = '00000000-0000-0000-0000-0000000000e1', cargado_at = now()
where entidad = 'envasado' and entidad_id = '00000000-0000-0000-0000-000000000b20' and orden = 1;

insert into _tap (l) select is(
  (select coalesce(tanque_codigo, 'null') || '/' || granel_id::text || '/' || listo::text || '/' || lote_doc
   from produccion.v_flujo where id = (select v from _ids where k = 'env3')),
  'null/00000000-0000-0000-0000-0000000000d1/false/L-DOC-3', 'v_flujo: envasado esperando sin tanque, con su granel y no listo');
insert into _tap (l) select is(
  (select producto from produccion.v_flujo where id = (select v from _ids where k = 'env3')),
  (select nombre from produccion.productos where id = '00000000-0000-0000-0000-0000000000d1'),
  'v_flujo: el producto del envasado esperando sale del granel');
insert into _tap (l) select is(
  (select count(*)::int from produccion.v_tareas where id = (select v from _ids where k = 'env3')),
  0, 'v_tareas: el envasado esperando no es tarea');
insert into _tap (l) select is(
  (select consumibles_total::text || '/' || consumibles_con_lote::text || '/' || lote_doc || '/' || descripcion
   from produccion.v_tareas where id = '00000000-0000-0000-0000-000000000b20'),
  '3/1/L-DOC-4/Desc vistas', 'v_tareas: consumibles 3 en total, 1 con lote; lote_doc y descripcion');
insert into _tap (l) select is(
  (select count(*)::int from produccion.v_tareas
   where entidad = 'fabricacion' and (consumibles_total <> 0 or consumibles_con_lote <> 0)),
  0, 'v_tareas: la fabricación no tiene consumibles');
insert into _tap (l) select is(
  (select jsonb_array_length(consumibles)::text || '/' || (consumibles->0->>'codigo') || '/' || (consumibles->0->>'lote')
          || '/' || (consumibles->0->>'cargado_nombre') || '/' || coalesce(consumibles->1->>'lote', 'null')
   from produccion.v_historial where id = '00000000-0000-0000-0000-000000000b20'),
  '3/110001/LC-1/Laura Paz/null', 'v_historial: consumibles en orden con lote y quién lo cargó');
insert into _tap (l) select is(
  (select origen from produccion.v_historial where entidad = 'fabricacion' and lote = 'L-STK-1'),
  'stock', 'v_historial: origen stock en el granel de stock');
insert into _tap (l) select is(
  (select producto || '/' || consumibles::text || '/' || coalesce(origen, 'null')
   from produccion.v_historial where id = (select v from _ids where k = 'env3')),
  'Lavandina-test/[]/null', 'v_historial: el envasado esperando (sin fabricación) aparece con su granel');
insert into _tap (l) select is(
  (select origen from produccion.v_flujo where entidad = 'fabricacion' and lote = 'L-STK-1'),
  'stock', 'v_flujo: origen stock en el granel de stock');
insert into _tap (l) select is(
  (select count(*)::int from produccion.v_flujo where entidad in ('envasado', 'fraccionado') and origen is not null),
  0, 'v_flujo: origen null en envasados y fraccionados');
insert into _tap (l) select lives_ok($$select produccion.revisar_alertas()$$,
  'revisar_alertas corre con un envasado esperando');
insert into _tap (l) select lives_ok($$select count(*) from produccion.v_tanque_estado$$,
  'v_tanque_estado corre con un envasado esperando');

insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
