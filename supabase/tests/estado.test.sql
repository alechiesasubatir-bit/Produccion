-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(4);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, operaria_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar', '00000000-0000-0000-0000-0000000000e1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- I1: el estado solo cambia vía accion()
insert into _tap (l) select throws_ok(
  $$update produccion.fabricaciones set estado = 'finalizada' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', null, 'panel no puede cambiar estado directo');
insert into _tap (l) select lives_ok(
  $$update produccion.fabricaciones set lote = 'L-9' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  'panel sí edita datos no de estado');

-- I2: fabricación para_envasar con merma: la tablet no la cierra, el panel sí
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'finalizar',
    '00000000-0000-0000-0000-0000000000e1', '1234')->>'codigo',
  'TRANSICION_INVALIDA', 'tablet no cierra una fabricación para_envasar');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('fabricacion', '00000000-0000-0000-0000-0000000000b1', 'finalizar')->>'estado',
  'finalizada', 'panel cierra una fabricación para_envasar con merma');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
