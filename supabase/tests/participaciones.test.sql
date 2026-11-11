-- Ejecutar: begin; + 013 + 014 + _fixtures.sql + este archivo (execute_sql no soporta \i).
insert into _tap (l) select plan(6);
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

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
