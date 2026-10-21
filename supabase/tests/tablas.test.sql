-- Ejecutar: begin; + _fixtures.sql + este archivo (execute_sql no soporta \i).
insert into _tap (l) select plan(4);

insert into _tap (l) select has_table('produccion', 'eventos', 'existe produccion.eventos');

insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 1000, 'fabricando');

insert into _tap (l) select throws_ok(
  $$insert into produccion.fabricaciones (tanque_id, producto_id, litros, estado)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 500, 'cola')$$,
  '23505', null, 'no se puede encolar otra fabricación en un tanque ocupado');

update produccion.fabricaciones set estado = 'finalizada' where id = '00000000-0000-0000-0000-0000000000b1';

insert into _tap (l) select lives_ok(
  $$insert into produccion.fabricaciones (tanque_id, producto_id, litros, estado)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 500, 'cola')$$,
  'se puede encolar si la anterior está finalizada');

insert into _tap (l) select throws_ok(
  $$insert into produccion.fabricaciones (tanque_id, producto_id, litros, estado)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 500, 'terminada')$$,
  '23514', null, 'estado inválido rechazado');

insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
