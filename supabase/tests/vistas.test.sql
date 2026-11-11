-- Ejecutar: begin; + _fixtures.sql + este archivo.
insert into _tap (l) select plan(11);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Escenario (como postgres): T-TEST libre · T-TEST2 envasando · T-TEST3 sobre-envasado
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c2', 'T-TEST2', 2000, 2),
  ('00000000-0000-0000-0000-0000000000c3', 'T-TEST3', 2000, 3);
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

-- Operarias, etiqueta y participaciones (como postgres)
insert into produccion.fraccionados (id, tipo, producto_id, presentacion_id, cantidad, estado, etiqueta_id) values
  ('00000000-0000-0000-0000-0000000000b8', 'otro', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000f1', 2, 'cola', '00000000-0000-0000-0000-0000000000e7');
insert into produccion.participaciones (entidad, entidad_id, empleado_id, desde, hasta, cantidad, unidad, cantidad_corregida)
select 'envasado', id, '00000000-0000-0000-0000-0000000000e1', now() - interval '30 minutes', null, null, null, null
  from produccion.envasados where fabricacion_id = '00000000-0000-0000-0000-0000000000b2';
insert into produccion.participaciones (entidad, entidad_id, empleado_id, desde)
select 'envasado', id, '00000000-0000-0000-0000-0000000000e2', now() - interval '50 minutes'
  from produccion.envasados where fabricacion_id = '00000000-0000-0000-0000-0000000000b2';
insert into produccion.participaciones (entidad, entidad_id, empleado_id, desde, hasta, cantidad, unidad, cantidad_corregida)
select 'envasado', id, '00000000-0000-0000-0000-0000000000e2', '2026-01-05 10:00-03', '2026-01-05 11:00-03', 3, 'L', 5
  from produccion.envasados where fabricacion_id = '00000000-0000-0000-0000-0000000000b3';
insert into produccion.eventos (entidad, entidad_id, accion, at)
select 'envasado', id, a.accion, a.at
  from produccion.envasados, (values ('pausar', '2026-01-05 10:10-03'::timestamptz), ('reanudar', '2026-01-05 10:30-03')) a(accion, at)
  where fabricacion_id = '00000000-0000-0000-0000-0000000000b3';
insert into produccion.eventos (entidad, entidad_id, accion, at) values
  ('fabricacion', '00000000-0000-0000-0000-000000000098', 'pausar',    '2026-01-05 10:40-03'),
  ('fabricacion', '00000000-0000-0000-0000-000000000098', 'finalizar', '2026-01-05 10:50-03');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

insert into _tap (l) select is(
  (select estado from produccion.v_tanque_estado where codigo = 'T-TEST'), 'libre',
  'tanque sin fabricaciones: libre');
insert into _tap (l) select is(
  (select estado from produccion.v_tanque_estado where codigo = 'T-TEST2'), 'envasando',
  'para_envasar con envasado activo: envasando');
insert into _tap (l) select is(
  (select litros_restantes from produccion.v_tanque_estado where codigo = 'T-TEST3'), 0::numeric,
  'sobre-envasado: litros_restantes = 0, nunca negativo');
insert into _tap (l) select results_eq(
  $$select min_brutos::int, min_pausa::int, min_efectivos::int from produccion.v_tiempos_efectivos
    where entidad_id = '00000000-0000-0000-0000-000000000099'$$,
  $$values (60, 10, 50)$$,
  'tiempos: 60 brutos, 10 de pausa, 50 efectivos');

-- Varias operarias, etiqueta y participaciones en las vistas
insert into _tap (l) select is(
  (select string_agg(o.v->>'nombre', ',' order by o.n)
   from produccion.v_tareas t, jsonb_array_elements(t.operarias) with ordinality o(v, n)
   where t.entidad = 'envasado' and t.id = (select id from produccion.envasados where fabricacion_id = '00000000-0000-0000-0000-0000000000b2')),
  'Rosa Díaz,Laura Paz', 'v_tareas.operarias: abiertas ordenadas por desde');
insert into _tap (l) select is(
  (select operarias::text || '/' || etiqueta from produccion.v_tareas where id = '00000000-0000-0000-0000-0000000000b8'),
  '[]/Etiqueta-test', 'v_tareas: sin participaciones operarias es [] y trae la etiqueta');
insert into _tap (l) select is(
  (select jsonb_array_length(operarias) from produccion.v_flujo
   where entidad = 'envasado' and id = (select id from produccion.envasados where fabricacion_id = '00000000-0000-0000-0000-0000000000b2')),
  2, 'v_flujo.operarias: las dos abiertas');
insert into _tap (l) select is(
  (select (h.participaciones->0->>'hasta') is not null || '/' || (h.participaciones->0->>'cantidad_corregida') || '/' || (h.participaciones->0->>'cantidad')
   from produccion.v_historial h
   where h.entidad = 'envasado' and h.id = (select id from produccion.envasados where fabricacion_id = '00000000-0000-0000-0000-0000000000b3')),
  'true/5/3', 'v_historial.participaciones: incluye cerradas con la cantidad corregida');
insert into _tap (l) select is(
  (select (h.participaciones->0->>'minutos')::numeric
   from produccion.v_historial h
   where h.entidad = 'envasado' and h.id = (select id from produccion.envasados where fabricacion_id = '00000000-0000-0000-0000-0000000000b3')),
  40::numeric, 'v_historial.participaciones: minutos = tramo de 60 menos 20 de pausa');
insert into _tap (l) select is(
  produccion._minutos_participacion('fabricacion', '00000000-0000-0000-0000-000000000098', '2026-01-05 10:00-03', '2026-01-05 11:00-03'),
  50::numeric, '_minutos_participacion: una pausa que termina en finalizar descuenta hasta ese evento');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into _tap (l) select results_eq(
  $$select count(*)::int from produccion.v_tanque_estado$$, $$values (0)$$,
  'usuario sin rol no ve la vista');

reset role;
insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
