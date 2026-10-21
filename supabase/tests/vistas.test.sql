-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(5);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres): T-01 libre · T-02 envasando · T-03 sobre-envasado
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-02', 2000, 2),
  ('00000000-0000-0000-0000-0000000000c3', 'T-03', 2000, 3);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 100, 'para_envasar'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d1', 10, 'para_envasar');
insert into produccion.envasados (fabricacion_id, presentacion_id, cantidad, estado, operaria_1) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f1', 4, 'activo', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', 3, 'finalizado', '00000000-0000-0000-0000-0000000000e2');
insert into produccion.eventos (entidad, entidad_id, accion, at) values
  ('fabricacion', '00000000-0000-0000-0000-000000000099', 'iniciar',   '2026-01-05 10:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-000000000099', 'pausar',    '2026-01-05 10:20-03'),
  ('fabricacion', '00000000-0000-0000-0000-000000000099', 'reanudar',  '2026-01-05 10:30-03'),
  ('fabricacion', '00000000-0000-0000-0000-000000000099', 'finalizar', '2026-01-05 11:00-03');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

insert into _tap (l) select is(
  (select estado from produccion.v_tanque_estado where codigo = 'T-01'), 'libre',
  'tanque sin fabricaciones: libre');
insert into _tap (l) select is(
  (select estado from produccion.v_tanque_estado where codigo = 'T-02'), 'envasando',
  'para_envasar con envasado activo: envasando');
insert into _tap (l) select is(
  (select litros_restantes from produccion.v_tanque_estado where codigo = 'T-03'), 0::numeric,
  'sobre-envasado: litros_restantes = 0, nunca negativo');
insert into _tap (l) select results_eq(
  $$select min_brutos::int, min_pausa::int, min_efectivos::int from produccion.v_tiempos_efectivos
    where entidad_id = '00000000-0000-0000-0000-000000000099'$$,
  $$values (60, 10, 50)$$,
  'tiempos: 60 brutos, 10 de pausa, 50 efectivos');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into _tap (l) select results_eq(
  $$select count(*)::int from produccion.v_tanque_estado$$, $$values (0)$$,
  'usuario sin rol no ve la vista');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
