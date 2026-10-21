-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(7);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres): T-TEST2 para_envasar con un envasado terminado hoy y otro hace 2 días
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-TEST2', 2000, 2);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar');
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, fin) values
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f1', 10, 'finalizado', now()),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f1', 10, 'finalizado', now() - interval '2 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 1. alta → evento crear con quién
insert into produccion.fabricaciones (tanque_id, producto_id, litros, lote)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 500, 'L-1');
select set_config('t.fab', (select id::text from produccion.fabricaciones where lote = 'L-1'), true);
insert into _tap (l) select is(
  (select count(*)::int from produccion.eventos
   where entidad_id = current_setting('t.fab')::uuid and accion = 'crear'
     and usuario_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'alta de orden registra evento crear con el usuario');

-- 2. edición → evento editar con lo cambiado; un cambio de estado por accion() no suma editar
update produccion.fabricaciones set lote = 'L-2' where id = current_setting('t.fab')::uuid;
select produccion.accion('fabricacion', current_setting('t.fab')::uuid, 'iniciar');
insert into _tap (l) select is(
  (select string_agg(datos->>'lote', ',') from produccion.eventos
   where entidad_id = current_setting('t.fab')::uuid and accion = 'editar'),
  'L-2', 'edición registra solo lo cambiado; accion() no genera editar');

-- 3. v_flujo: terminadas de hoy sí, de hace 2 días no
insert into _tap (l) select ok(
  exists (select 1 from produccion.v_flujo where id = '00000000-0000-0000-0000-0000000000a8')
  and not exists (select 1 from produccion.v_flujo where id = '00000000-0000-0000-0000-0000000000a9'),
  'v_flujo incluye lo terminado hoy y no lo de otros días');

-- 4. la tablet no lista usuarios
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select throws_ok(
  'select * from produccion.listar_usuarios()', '42501', null, 'tablet no puede listar usuarios');

-- 5-7. roles
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select produccion.set_rol_usuario('00000000-0000-0000-0000-0000000000a3', 'planta');
reset role;
insert into _tap (l) select is(
  (select rol_produccion from public.perfiles where id = '00000000-0000-0000-0000-0000000000a3'),
  'planta', 'panel asigna rol de producción');
set local role authenticated;

insert into _tap (l) select throws_ok(
  $$select produccion.set_rol_usuario('00000000-0000-0000-0000-0000000000a1', null)$$,
  '42501', 'NO_PROPIO_ROL', 'no se puede cambiar el propio rol');

insert into _tap (l) select throws_ok(
  $$select produccion.set_rol_usuario('00000000-0000-0000-0000-0000000000a3', 'jefe')$$,
  '22023', null, 'rol inválido rechazado');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
