-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(6);
-- (contenido de _tap_grants.sql)
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Tablet ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

insert into _tap (l) select throws_ok(
  $$insert into produccion.fabricaciones (tanque_id, producto_id, litros)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 500)$$,
  '42501', null, 'tablet no puede insertar fabricaciones directo');

insert into _tap (l) select results_eq(
  $$select count(*)::int from produccion.tanques where codigo = 'T-TEST'$$, $$values (1)$$,
  'tablet lee tanques');

insert into _tap (l) select throws_ok(
  $$select pin_hash from produccion.operarias$$,
  '42501', null, 'tablet no puede leer pin_hash');

insert into _tap (l) select results_eq(
  $$select count(*)::int from produccion.v_operarias where empleado_id::text like '00000000-0000-0000-0000-0000000000e_'$$, $$values (2)$$,
  'v_operarias excluye a la operaria dada de baja en core');

-- Panel -------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

insert into _tap (l) select lives_ok(
  $$insert into produccion.fabricaciones (tanque_id, producto_id, litros)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 500)$$,
  'panel inserta fabricaciones');

-- Usuario sin rol de producción -------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

insert into _tap (l) select results_eq(
  $$select count(*)::int from produccion.tanques$$, $$values (0)$$,
  'usuario sin rol no ve tanques');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
