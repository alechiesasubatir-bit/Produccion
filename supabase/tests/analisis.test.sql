-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(7);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres) -------------------------------------------------
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-TEST2', 2000, 2),
  ('00000000-0000-0000-0000-0000000000c3', 'T-TEST3', 2000, 3),
  ('00000000-0000-0000-0000-0000000000c4', 'T-TEST4', 2000, 4),
  ('00000000-0000-0000-0000-0000000000c5', 'T-TEST5', 2000, 5);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, inicio, fin) values
  -- b1: para envasar, con un envasado terminado (a1) y uno pausado hace 40 min (a2)
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar', null, null),
  -- b2: cruza la medianoche
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 500, 'finalizada', '2026-01-05 23:30-03', '2026-01-06 01:15-03'),
  -- b3, b4: terminadas, 600 L en 60 y 120 min efectivos (estándar 7,5 L/min)
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 600, 'finalizada', null, null),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1', 600, 'finalizada', null, null),
  -- b5: fabricando hace 10 h
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d1', 800, 'fabricando', now() - interval '10 hours', null),
  -- b6: lista para envasar sin envasados
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000d1', 800, 'para_envasar', null, null);
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, operaria_1) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 20, 'finalizado', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 20, 'pausado', '00000000-0000-0000-0000-0000000000e2');
insert into produccion.eventos (entidad, entidad_id, accion, at) values
  ('envasado', '00000000-0000-0000-0000-0000000000a1', 'iniciar',   '2026-01-05 10:00-03'),
  ('envasado', '00000000-0000-0000-0000-0000000000a1', 'pausar',    '2026-01-05 10:10-03'),
  ('envasado', '00000000-0000-0000-0000-0000000000a1', 'reanudar',  '2026-01-05 10:20-03'),
  ('envasado', '00000000-0000-0000-0000-0000000000a1', 'finalizar', '2026-01-05 11:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-0000000000b3', 'iniciar',   '2026-01-06 08:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-0000000000b3', 'finalizar', '2026-01-06 09:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-0000000000b4', 'iniciar',   '2026-01-07 08:00-03'),
  ('fabricacion', '00000000-0000-0000-0000-0000000000b4', 'finalizar', '2026-01-07 10:00-03'),
  ('envasado', '00000000-0000-0000-0000-0000000000a2', 'iniciar', now() - interval '60 minutes'),
  ('envasado', '00000000-0000-0000-0000-0000000000a2', 'pausar',  now() - interval '40 minutes');

-- 1-2. v_historial ------------------------------------------------------------
insert into _tap (l) select is(
  (select min_efectivos::int || '/' || operaria_1_nombre from produccion.v_historial
   where id = '00000000-0000-0000-0000-0000000000a1'),
  '50/Laura Paz', 'historial: tiempo efectivo sin pausas y nombre de la operaria');
insert into _tap (l) select is(
  (select dia from produccion.v_historial where id = '00000000-0000-0000-0000-0000000000b2'),
  '2026-01-06'::date, 'una tarea que cruza la medianoche cuenta el día en que terminó');

-- 3. v_tiempos_estandar ---------------------------------------------------------
insert into _tap (l) select is(
  (select velocidad from produccion.v_tiempos_estandar where entidad = 'fabricacion' and clave = 'Lavandina-test'),
  7.5::numeric, 'estándar: promedio de L/min efectivos de las fabricaciones terminadas');

-- 4-6. revisar_alertas ------------------------------------------------------------
select produccion.revisar_alertas();
insert into _tap (l) select is(
  (select count(*)::int from produccion.alertas
   where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-0000000000b5')
  || '/' || produccion.revisar_alertas(),
  '1/0', 'crea la alerta de más de 9 h una sola vez');

update produccion.alertas set pospuesta_hasta = now() + interval '1 hour'
where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-0000000000b5';
select produccion.revisar_alertas();
insert into _tap (l) select is(
  (select count(*)::int from produccion.alertas
   where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-0000000000b5'),
  1, 'posponer no genera un duplicado');

insert into _tap (l) select ok(
  exists (select 1 from produccion.alertas where tipo = 'falta_envasado' and entidad_id = '00000000-0000-0000-0000-0000000000b6')
  and exists (select 1 from produccion.alertas where tipo = 'pausa_larga' and entidad_id = '00000000-0000-0000-0000-0000000000a2'),
  'alertas de falta de envasado y de pausa larga');

-- 7. solo el cron (postgres) corre revisar_alertas -------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select throws_ok('select produccion.revisar_alertas()', '42501', null, 'la tablet no puede correr revisar_alertas');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
