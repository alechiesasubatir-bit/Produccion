-- Ejecutar: begin; + _fixtures.sql + este archivo.
-- Alerta 'sin_control' (más de 1 h en control) y exceso_9h contado desde el último rechazo.
insert into _tap (l) select plan(6);

insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000001c2', 'T-CTRL2', 2000, 2),
  ('00000000-0000-0000-0000-0000000001c3', 'T-CTRL3', 2000, 3),
  ('00000000-0000-0000-0000-0000000001c4', 'T-CTRL4', 2000, 4),
  ('00000000-0000-0000-0000-0000000001c5', 'T-CTRL5', 2000, 5);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, inicio) values
  -- k1: en control desde hace 2 h
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 500, 'en_control', now() - interval '4 hours'),
  -- k2: en control desde hace 30 min
  ('00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000001c2', '00000000-0000-0000-0000-0000000000d1', 500, 'en_control', now() - interval '3 hours'),
  -- k3: finalizada hace 3 h, rechazada, vuelta a finalizar hace 20 min
  ('00000000-0000-0000-0000-0000000001b3', '00000000-0000-0000-0000-0000000001c3', '00000000-0000-0000-0000-0000000000d1', 500, 'en_control', now() - interval '5 hours'),
  -- k4: iniciada hace 10 h, rechazada hace 1 h → fabricando de nuevo
  ('00000000-0000-0000-0000-0000000001b4', '00000000-0000-0000-0000-0000000001c4', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now() - interval '10 hours'),
  -- k5: iniciada hace 12 h, rechazada hace 10 h → fabricando de nuevo
  ('00000000-0000-0000-0000-0000000001b5', '00000000-0000-0000-0000-0000000001c5', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now() - interval '12 hours');
insert into produccion.eventos (entidad, entidad_id, accion, at) values
  ('fabricacion', '00000000-0000-0000-0000-0000000001b1', 'finalizar', now() - interval '2 hours'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b2', 'finalizar', now() - interval '30 minutes'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b3', 'finalizar', now() - interval '3 hours'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b3', 'rechazar',  now() - interval '150 minutes'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b3', 'finalizar', now() - interval '20 minutes'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b4', 'finalizar', now() - interval '2 hours'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b4', 'rechazar',  now() - interval '1 hour'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b5', 'finalizar', now() - interval '11 hours'),
  ('fabricacion', '00000000-0000-0000-0000-0000000001b5', 'rechazar',  now() - interval '10 hours');

select produccion.revisar_alertas();

insert into _tap (l) select is(
  (select texto from produccion.alertas where tipo = 'sin_control' and entidad_id = '00000000-0000-0000-0000-0000000001b1'),
  'Fabricación de Lavandina-test en T-TEST lleva más de 1 h esperando el control.',
  'más de 1 h en control crea la alerta');
insert into _tap (l) select ok(
  not exists (select 1 from produccion.alertas where tipo = 'sin_control' and entidad_id = '00000000-0000-0000-0000-0000000001b2'),
  'menos de 1 h en control no alerta');
insert into _tap (l) select ok(
  not exists (select 1 from produccion.alertas where tipo = 'sin_control' and entidad_id = '00000000-0000-0000-0000-0000000001b3'),
  'tras un rechazo el reloj del control arranca en el último finalizar');
insert into _tap (l) select ok(
  not exists (select 1 from produccion.alertas where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-0000000001b4'),
  'la alerta de 9 h cuenta desde el último rechazo');
insert into _tap (l) select ok(
  exists (select 1 from produccion.alertas where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-0000000001b5'),
  'más de 9 h desde el rechazo sí alerta');

update produccion.fabricaciones set estado = 'para_envasar' where id = '00000000-0000-0000-0000-0000000001b1';
select produccion.revisar_alertas();
insert into _tap (l) select ok(
  not exists (select 1 from produccion.alertas where tipo = 'sin_control' and entidad_id = '00000000-0000-0000-0000-0000000001b1'),
  'controlar la fabricación resuelve la alerta');

insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
