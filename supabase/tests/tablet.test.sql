-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(7);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres): T-TEST para_envasar 10 L con envasado A activo (E1, 3 × 5L) y B en cola;
-- T-TEST2 con una fabricación en cola.
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-TEST2', 2000, 2);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, operaria_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 10, 'para_envasar', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 500, 'cola', null);
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, operaria_1) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 3, 'activo', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 2, 'cola', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 1-4. verificar_pin
insert into _tap (l) select is(
  (produccion.verificar_pin('00000000-0000-0000-0000-0000000000e1', '1234')->>'ok')::boolean, true,
  'PIN correcto');

select set_config('t.r', produccion.verificar_pin('00000000-0000-0000-0000-0000000000e1', '9999')::text, true);
reset role;
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'codigo') || '/' ||
  (select pin_intentos from produccion.operarias where empleado_id = '00000000-0000-0000-0000-0000000000e1'),
  'PIN_INCORRECTO/1', 'PIN incorrecto suma un intento que persiste');
set local role authenticated;

select produccion.verificar_pin('00000000-0000-0000-0000-0000000000e2', '9999') from generate_series(1, 5);
insert into _tap (l) select is(
  produccion.verificar_pin('00000000-0000-0000-0000-0000000000e2', '1234')->>'codigo', 'PIN_BLOQUEADO',
  '5 errores bloquean aunque el siguiente sea correcto');

insert into _tap (l) select is(
  produccion.verificar_pin('00000000-0000-0000-0000-0000000000e3', '1234')->>'codigo', 'OPERARIA_INACTIVA',
  'operaria dada de baja');

-- 5. terminar un envasado no cierra la fabricación si quedan hermanos pendientes
select set_config('t.r', produccion.accion('envasado', '00000000-0000-0000-0000-0000000000aa', 'finalizar',
  '00000000-0000-0000-0000-0000000000e1', '1234')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'fabricacion_cerrada') || '/' ||
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-0000000000b1'),
  'false/para_envasar', 'con un envasado en cola la fabricación no se cierra sola');

-- 6. v_tareas
insert into _tap (l) select ok(
  exists (select 1 from produccion.v_tareas
          where id = '00000000-0000-0000-0000-0000000000ab' and entidad = 'envasado' and listo
            and tanque_codigo = 'T-TEST' and producto = 'Lavandina-test' and presentacion = '5L-test')
  and exists (select 1 from produccion.v_tareas
              where id = '00000000-0000-0000-0000-0000000000b2' and entidad = 'fabricacion' and estado = 'cola'),
  'v_tareas: envasado en cola listo con datos de su fabricación, y fabricación en cola');

-- 7. usuario sin rol
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into _tap (l) select results_eq(
  $$select count(*)::int from produccion.v_tareas$$, $$values (0)$$,
  'usuario sin rol no ve tareas');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
