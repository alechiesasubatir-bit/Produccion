-- Ejecutar: begin; + 018 + _fixtures.sql + este archivo (execute_sql no soporta \i).
-- Pausa general (migración 018): tablas, pausa_general(), arranque_general(), bloqueo de planta y alertas.
insert into _tap (l) select plan(63);
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace = pg_my_temp_schema() and relkind in ('r', 'S') loop
    execute format('grant all on pg_temp.%I to public', r.relname);
  end loop;
end $$;

-- Esquema ---------------------------------------------------------------------
insert into _tap (l) select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('produccion.pausas_generales'::regclass, 'produccion.pausa_general_ordenes'::regclass)),
  'pausas_generales y pausa_general_ordenes tienen RLS');
insert into _tap (l) select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'produccion' and tablename = 'pausas_generales'),
  'pausas_generales está en la publicación de realtime');

-- Escenario (como postgres). La base es la real: las órdenes reales en marcha se dan por
-- canceladas para que no entren en la pausa (todo se revierte con el rollback).
--   F_A …511 (T-PG1, fabricando, E1) · F_B …512 (T-PG2, para_envasar)
--   envasado X …521 (activo, E1+E2) · Y …522 (activo, sin participaciones) · Z …523 (cola)
--   fraccionado W …531 (pausado, E2)
update produccion.fabricaciones set estado = 'cancelada', fin = now() where estado in ('fabricando', 'pausada');
update produccion.envasados set estado = 'cancelado', fin = now() where estado in ('activo', 'pausado');
update produccion.fraccionados set estado = 'cancelado', fin = now() where estado in ('activo', 'pausado');

insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-000000000501', 'T-PG1', 2000, 1),
  ('00000000-0000-0000-0000-000000000502', 'T-PG2', 2000, 2);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, inicio) values
  ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar', now() - interval '5 hours');
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, inicio) values
  ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-0000000000f1', 20, 'activo', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000522', '00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-0000000000f1', 10, 'activo', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000523', '00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-0000000000f1', 10, 'cola', null);
insert into produccion.fraccionados (id, tipo, producto_id, presentacion_id, cantidad, estado, inicio) values
  ('00000000-0000-0000-0000-000000000531', 'otro', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 5, 'pausado', now() - interval '2 hours');
insert into produccion.participaciones (entidad, entidad_id, empleado_id, desde) values
  ('fabricacion', '00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-0000000000e1', now() - interval '3 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-0000000000e1', now() - interval '2 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-0000000000e2', now() - interval '2 hours'),
  ('fraccionado', '00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-0000000000e2', now() - interval '2 hours');

-- Planta ----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.pausa_general('[]')->>'codigo', 'NO_AUTORIZADO', 'planta no puede hacer la pausa general');

-- Panel -----------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select throws_ok(
  $$insert into produccion.pausas_generales (iniciada_por) values ('00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'el panel no inserta directo en pausas_generales');

-- Falta la cantidad de E2 en el envasado X → nada aplicado
select set_config('t.r', produccion.pausa_general('[
  {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000521","empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":40,"unidad":"L"},
  {"entidad":"fraccionado","entidad_id":"00000000-0000-0000-0000-000000000531","empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":12,"unidad":"kg"}
]')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'codigo') || ' / ' || (current_setting('t.r')::jsonb->>'detalle'),
  'CANTIDAD_REQUERIDA / Rosa Díaz en Lavandina-test 5L-test',
  'falta una cantidad: CANTIDAD_REQUERIDA con la operaria y la orden');
reset role;
insert into _tap (l) select is(
  (select count(*)::int from produccion.pausas_generales) || '/' ||
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-000000000511') || '/' ||
  (select string_agg(estado, ',' order by id) from produccion.envasados
   where id in ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000522')) || '/' ||
  (select count(*)::int from produccion.participaciones
   where entidad_id in ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000521',
                        '00000000-0000-0000-0000-000000000531') and hasta is null) || '/' ||
  (select count(*)::int from produccion.eventos where datos ? 'pausa_general'),
  '0/fabricando/activo,activo/4/0',
  'tras CANTIDAD_REQUERIDA no queda pausa, ni cambios de estado, participaciones o eventos');

-- Cantidades completas (la de la fabricación se ignora)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.r', produccion.pausa_general('[
  {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000521","empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":40,"unidad":"L"},
  {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000521","empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":35.5,"unidad":"L"},
  {"entidad":"fraccionado","entidad_id":"00000000-0000-0000-0000-000000000531","empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":12,"unidad":"kg"},
  {"entidad":"fabricacion","entidad_id":"00000000-0000-0000-0000-000000000511","empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":99,"unidad":"L"}
]')::text, true);
select set_config('t.pid', coalesce(current_setting('t.r')::jsonb->>'pausa_id', ''), true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' || (current_setting('t.r')::jsonb->>'ordenes'),
  'true/4', 'pausa general desde el panel: ok con 4 órdenes');
insert into _tap (l) select is(
  (select count(*)::int from produccion.pausas_generales where fin is null and iniciada_por = '00000000-0000-0000-0000-0000000000a1'),
  1, 'el panel lee la pausa abierta, iniciada por quien la hizo');
insert into _tap (l) select is(
  (select count(*)::int from produccion.pausa_general_ordenes where pausa_id::text = current_setting('t.pid')),
  4, 'el panel lee pausa_general_ordenes');

-- Planta lee la pausa pero no sus órdenes
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  (select count(*)::int from produccion.pausas_generales where fin is null) || '/' ||
  (select count(*)::int from produccion.pausa_general_ordenes),
  '1/0', 'planta lee pausas_generales pero no pausa_general_ordenes');

reset role;
insert into _tap (l) select is(
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-000000000511') || '/' ||
  (select string_agg(estado, ',' order by id) from produccion.envasados
   where id in ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000522',
                '00000000-0000-0000-0000-000000000523')) || '/' ||
  (select estado from produccion.fraccionados where id = '00000000-0000-0000-0000-000000000531'),
  'pausada/pausado,pausado,cola/pausado',
  'las en curso quedan pausadas, el fraccionado sigue pausado y el de cola no se toca');

insert into _tap (l) select is(
  (select string_agg(entidad || ':' || right(entidad_id::text, 3), ',' order by entidad, entidad_id)
   from produccion.eventos where accion = 'pausar' and datos->>'pausa_general' = current_setting('t.pid')),
  'envasado:521,envasado:522,fabricacion:511',
  'un evento pausar por cada orden que estaba en curso (ninguno para el fraccionado pausado)');
insert into _tap (l) select ok(
  (select bool_and(usuario_id = '00000000-0000-0000-0000-0000000000a1' and empleado_id is null)
   from produccion.eventos where accion = 'pausar' and datos->>'pausa_general' = current_setting('t.pid')),
  'los pausar llevan usuario_id del panel y sin empleado');
insert into _tap (l) select is(
  (select string_agg(entidad || ':' || right(entidad_id::text, 3) || ':' || right(empleado_id::text, 2) || ':'
                     || coalesce(datos->>'cantidad', '-') || coalesce(datos->>'unidad', ''),
                     ',' order by entidad, entidad_id, empleado_id)
   from produccion.eventos where accion = 'salir' and datos->>'pausa_general' = current_setting('t.pid')),
  'envasado:521:e1:40L,envasado:521:e2:35.5L,fabricacion:511:e1:-,fraccionado:531:e2:12kg',
  'un salir por participación, con cantidad y unidad en envasado/fraccionado');
insert into _tap (l) select ok(
  (select bool_and(usuario_id = '00000000-0000-0000-0000-0000000000a1')
   from produccion.eventos where accion = 'salir' and datos->>'pausa_general' = current_setting('t.pid')),
  'los salir llevan usuario_id del panel');
insert into _tap (l) select is(
  (select count(*)::int from produccion.eventos
   where entidad_id = '00000000-0000-0000-0000-000000000523' and accion in ('pausar', 'salir')),
  0, 'el envasado en cola no tiene eventos de la pausa');

insert into _tap (l) select is(
  (select string_agg(entidad || ':' || right(entidad_id::text, 3) || ':' || right(empleado_id::text, 2) || ':'
                     || coalesce(cantidad::text, 'null') || coalesce(unidad, ''),
                     ',' order by entidad, entidad_id, empleado_id)
   from produccion.participaciones
   where entidad_id in ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000521',
                        '00000000-0000-0000-0000-000000000531') and hasta = now()),
  'envasado:521:e1:40L,envasado:521:e2:35.5L,fabricacion:511:e1:null,fraccionado:531:e2:12kg',
  'las participaciones quedan cerradas con su cantidad (fabricación sin cantidad)');
insert into _tap (l) select is(
  (select count(*)::int from produccion.participaciones where hasta is null
   and entidad_id in ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000521',
                      '00000000-0000-0000-0000-000000000531')),
  0, 'no quedan participaciones abiertas');

insert into _tap (l) select is(
  (select string_agg(o.entidad || ':' || right(o.entidad_id::text, 3) || ':' || o.estaba || ':'
                     || coalesce((select string_agg(right(u::text, 2), '+' order by u) from unnest(o.operarias) u), ''),
                     ',' order by o.entidad, o.entidad_id)
   from produccion.pausa_general_ordenes o where o.pausa_id::text = current_setting('t.pid')),
  'envasado:521:en_curso:e1+e2,envasado:522:en_curso:,fabricacion:511:en_curso:e1,fraccionado:531:pausada:e2',
  'pausa_general_ordenes: estaba y operarias de cada orden');
insert into _tap (l) select is(
  (produccion._pausa_general_abierta()).id::text, current_setting('t.pid'),
  '_pausa_general_abierta devuelve la pausa abierta');
insert into _tap (l) select throws_ok(
  $$insert into produccion.pausas_generales (iniciada_por) values ('00000000-0000-0000-0000-0000000000a1')$$,
  '23505', null, 'no puede haber dos pausas generales abiertas');

-- Segunda pausa con una abierta
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.pausa_general('[]')->>'codigo', 'PAUSA_GENERAL_ACTIVA', 'segunda pausa general: PAUSA_GENERAL_ACTIVA');

-- Bloqueo de planta (sección 2) -----------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('t.hora', (select to_char(inicio at time zone 'America/Montevideo', 'HH24:MI')
                             from produccion.pausas_generales where fin is null), true);
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000511', 'reanudar',
  '00000000-0000-0000-0000-0000000000e1')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'codigo') || ' ' || (current_setting('t.r')::jsonb->>'detalle'),
  'PAUSA_GENERAL ' || current_setting('t.hora'),
  'planta: accion() con pausa general abierta → PAUSA_GENERAL con la hora de inicio');
-- ids inexistentes: sin la pausa darían NO_ENCONTRADO, el bloqueo va antes
insert into _tap (l) select is(
  produccion.cargar_mp('00000000-0000-0000-0000-000000000599', 'L-1', true,
    '00000000-0000-0000-0000-0000000000e1')->>'codigo',
  'PAUSA_GENERAL', 'planta: cargar_mp() con pausa general → PAUSA_GENERAL');
insert into _tap (l) select is(
  produccion.cargar_consumible('00000000-0000-0000-0000-000000000599', 'L-1',
    '00000000-0000-0000-0000-0000000000e1')->>'codigo',
  'PAUSA_GENERAL', 'planta: cargar_consumible() con pausa general → PAUSA_GENERAL');
-- La carrera con pausa_general no se puede probar en una sola sesión: se controla que el bloqueo
-- de planta tome el lock de pausas_generales antes de leer la pausa (y antes de bloquear la orden).
insert into _tap (l) select is(
  (select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p
   where p.pronamespace = 'produccion'::regnamespace
     and p.proname in ('accion', 'cargar_mp', 'cargar_consumible')
     and strpos(p.prosrc, 'lock table produccion.pausas_generales in row exclusive mode') > 0
     and strpos(p.prosrc, 'lock table produccion.pausas_generales in row exclusive mode')
         < strpos(p.prosrc, '_pausa_general_abierta()')),
  'accion,cargar_consumible,cargar_mp',
  'planta: accion/cargar_mp/cargar_consumible toman el lock de pausas_generales antes de leer la pausa');
insert into _tap (l) select is(
  (select c.confdeltype::text from pg_constraint c
   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.conrelid = 'produccion.pausas_generales'::regclass and c.contype = 'f' and a.attname = 'terminada_por'),
  'n', 'pausas_generales.terminada_por: on delete set null');

-- El panel no se bloquea: cierra con merma la fabricación F_B (para_envasar)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.r', produccion.accion('fabricacion', '00000000-0000-0000-0000-000000000512', 'finalizar')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' || (current_setting('t.r')::jsonb->>'estado'),
  'true/finalizada', 'panel: accion(finalizar) funciona durante la pausa general');

-- Arranque: la fabricación con E2 y el envasado X con E1; Y y el fraccionado W quedan pausados
select set_config('t.r', produccion.arranque_general('[
  {"entidad":"fabricacion","entidad_id":"00000000-0000-0000-0000-000000000511","empleados":["00000000-0000-0000-0000-0000000000e2"]},
  {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000521","empleados":["00000000-0000-0000-0000-0000000000e1"]}
]')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' || (current_setting('t.r')::jsonb->>'reanudadas'),
  'true/2', 'arranque general: ok con 2 órdenes reanudadas');
reset role;
insert into _tap (l) select is(
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-000000000511') || '/' ||
  (select string_agg(estado, ',' order by id) from produccion.envasados
   where id in ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000522')) || '/' ||
  (select estado from produccion.fraccionados where id = '00000000-0000-0000-0000-000000000531'),
  'fabricando/activo,pausado/pausado',
  'las elegidas quedan en curso; las no elegidas siguen pausadas');
insert into _tap (l) select is(
  (select string_agg(entidad || ':' || right(entidad_id::text, 3) || ':' || right(empleado_id::text, 2),
                     ',' order by entidad, entidad_id, empleado_id)
   from produccion.participaciones where hasta is null
   and entidad_id in ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000521',
                      '00000000-0000-0000-0000-000000000522', '00000000-0000-0000-0000-000000000531')),
  'envasado:521:e1,fabricacion:511:e2', 'el arranque abre una participación nueva por operaria elegida');
insert into _tap (l) select is(
  (select string_agg(entidad || ':' || right(entidad_id::text, 3) || ':' || coalesce(right(empleado_id::text, 2), '-')
                     || ':' || (usuario_id = '00000000-0000-0000-0000-0000000000a1')::text,
                     ',' order by entidad, entidad_id)
   from produccion.eventos where accion = 'reanudar' and datos->>'pausa_general' = current_setting('t.pid')),
  'envasado:521:-:true,fabricacion:511:-:true', 'un reanudar con pausa_general por orden reanudada, del panel');
insert into _tap (l) select is(
  (select string_agg(entidad || ':' || right(entidad_id::text, 3) || ':' || right(empleado_id::text, 2)
                     || ':' || (usuario_id = '00000000-0000-0000-0000-0000000000a1')::text,
                     ',' order by entidad, entidad_id, empleado_id)
   from produccion.eventos where accion = 'sumarse' and datos->>'pausa_general' = current_setting('t.pid')),
  'envasado:521:e1:true,fabricacion:511:e2:true', 'un sumarse con pausa_general por operaria, con su empleado_id');
insert into _tap (l) select is(
  (select (fin is not null)::text || '/' || (terminada_por = '00000000-0000-0000-0000-0000000000a1')::text
   from produccion.pausas_generales where id::text = current_setting('t.pid')) || '/' ||
  ((produccion._pausa_general_abierta()) is null)::text,
  'true/true/true', 'el arranque cierra la pausa con fin y terminada_por');

-- Sin pausa, la planta vuelve a operar
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000521', 'pausar',
    '00000000-0000-0000-0000-0000000000e1')->>'ok',
  'true', 'tras el arranque la planta vuelve a operar');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Sin órdenes en marcha (pausa cerrada y todo terminado)
reset role;
update produccion.pausas_generales set fin = now() where fin is null;
update produccion.fabricaciones set estado = 'cancelada', fin = now() where estado in ('fabricando', 'pausada');
update produccion.envasados set estado = 'cancelado', fin = now() where estado in ('activo', 'pausado');
update produccion.fraccionados set estado = 'cancelado', fin = now() where estado in ('activo', 'pausado');
insert into _tap (l) select ok(
  (produccion._pausa_general_abierta()) is null, '_pausa_general_abierta sin pausa abierta: null');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.pausa_general('[]')->>'codigo', 'SIN_ORDENES', 'sin órdenes en marcha: SIN_ORDENES');
reset role;
insert into _tap (l) select is(
  (select count(*)::int from produccion.pausas_generales), 1, 'SIN_ORDENES no deja una pausa nueva');

-- Arranque: errores, en una pausa nueva -----------------------------------------
--   F_C …541 (T-PG1, fabricando, sin participaciones) · envasados V1 …551 (activo, E1),
--   V2 …552 (activo, E2), V3 …553 (activo, sin participaciones) · Z …523 sigue en cola
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, inicio) values
  ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now() - interval '1 hour');
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, inicio) values
  ('00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-0000000000f1', 10, 'activo', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000552', '00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-0000000000f1', 10, 'activo', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000553', '00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-0000000000f1', 10, 'activo', now() - interval '1 hour');
insert into produccion.participaciones (entidad, entidad_id, empleado_id, desde) values
  ('envasado', '00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-0000000000e1', now() - interval '1 hour'),
  ('envasado', '00000000-0000-0000-0000-000000000552', '00000000-0000-0000-0000-0000000000e2', now() - interval '1 hour');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.r', produccion.pausa_general('[
  {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000551","empleado_id":"00000000-0000-0000-0000-0000000000e1","cantidad":10,"unidad":"L"},
  {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000552","empleado_id":"00000000-0000-0000-0000-0000000000e2","cantidad":10,"unidad":"L"}
]')::text, true);
select set_config('t.pid2', coalesce(current_setting('t.r')::jsonb->>'pausa_id', ''), true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' || (current_setting('t.r')::jsonb->>'ordenes'),
  'true/4', 'segunda noche: pausa general con 4 órdenes');

insert into _tap (l) select is(
  (select (r->>'codigo') || ' / ' || (r->>'detalle') from (select produccion.arranque_general('[
    {"entidad":"fabricacion","entidad_id":"00000000-0000-0000-0000-000000000541","empleados":[]}
  ]') as r) x),
  'SIN_OPERARIAS / Lavandina-test T-PG1', 'orden sin operarias: SIN_OPERARIAS con producto y tanque');
insert into _tap (l) select is(
  (select (r->>'codigo') || ' / ' || (r->>'detalle') from (select produccion.arranque_general('[
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000551","empleados":["00000000-0000-0000-0000-0000000000e1"]},
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000552","empleados":["00000000-0000-0000-0000-0000000000e1"]}
  ]') as r) x),
  'OPERARIA_OCUPADA / Lavandina-test 5L-test', 'E1 en dos envasados de la lista: OPERARIA_OCUPADA con el otro envasado');
insert into _tap (l) select is(
  produccion.arranque_general('[
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000551","empleados":["00000000-0000-0000-0000-0000000000e3"]}
  ]')->>'codigo',
  'OPERARIA_INACTIVA', 'operaria de baja: OPERARIA_INACTIVA');

-- La encargada suma a E2 a mano en V2 (pausado) durante la noche: el arranque la controla igual
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000552', 'sumarse',
    '00000000-0000-0000-0000-0000000000e2')->>'ok',
  'true', 'panel: suma a E2 a mano en un envasado pausado durante la pausa general');
insert into _tap (l) select is(
  (select (r->>'codigo') || ' / ' || (r->>'detalle') from (select produccion.arranque_general('[
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000551","empleados":["00000000-0000-0000-0000-0000000000e2"]},
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000552","empleados":["00000000-0000-0000-0000-0000000000e1"]}
  ]') as r) x),
  'OPERARIA_OCUPADA / Lavandina-test 5L-test',
  'operaria sumada a mano en un envasado de la lista y elegida en otro: OPERARIA_OCUPADA');

-- La encargada reanuda V3 a mano en la noche y le suma a E2: E2 no puede volver a V2
insert into _tap (l) select is(
  (produccion.accion('envasado', '00000000-0000-0000-0000-000000000553', 'reanudar')->>'ok') || '/' ||
  (produccion.accion('envasado', '00000000-0000-0000-0000-000000000553', 'sumarse',
     '00000000-0000-0000-0000-0000000000e2')->>'ok'),
  'true/true', 'panel: reanuda y suma a mano durante la pausa general');
insert into _tap (l) select is(
  (select (r->>'codigo') || ' / ' || (r->>'detalle') from (select produccion.arranque_general('[
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000552","empleados":["00000000-0000-0000-0000-0000000000e2"]}
  ]') as r) x),
  'OPERARIA_OCUPADA / Lavandina-test 5L-test', 'E2 ya está en un envasado activo fuera de la lista: OPERARIA_OCUPADA');

-- Cancelada por la encargada en la noche
insert into _tap (l) select is(
  produccion.accion('envasado', '00000000-0000-0000-0000-000000000553', 'cancelar')->>'ok',
  'true', 'panel: cancela una orden durante la pausa general');
insert into _tap (l) select is(
  (select (r->>'codigo') || ' / ' || (r->>'detalle') from (select produccion.arranque_general('[
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000551","empleados":["00000000-0000-0000-0000-0000000000e1"]},
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000553","empleados":["00000000-0000-0000-0000-0000000000e2"]}
  ]') as r) x),
  'TRANSICION_INVALIDA / Lavandina-test 5L-test', 'orden cerrada en la noche: TRANSICION_INVALIDA con la orden');
reset role;
insert into _tap (l) select is(
  (select count(*)::int from produccion.pausas_generales where fin is null and id::text = current_setting('t.pid2')) || '/' ||
  (select estado from produccion.envasados where id = '00000000-0000-0000-0000-000000000551') || '/' ||
  (select count(*)::int from produccion.participaciones
   where entidad_id = '00000000-0000-0000-0000-000000000551' and hasta is null) || '/' ||
  (select count(*)::int from produccion.eventos
   where accion in ('reanudar', 'sumarse') and datos->>'pausa_general' = current_setting('t.pid2')),
  '1/pausado/0/0', 'tras un error del arranque la pausa sigue abierta y no queda nada aplicado');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.arranque_general('[
    {"entidad":"envasado","entidad_id":"00000000-0000-0000-0000-000000000523","empleados":["00000000-0000-0000-0000-0000000000e1"]}
  ]')->>'codigo',
  'NO_ENCONTRADO', 'orden que no está en la pausa general: NO_ENCONTRADO');

-- Lista vacía: levanta la pausa sin reanudar nada
select set_config('t.r', produccion.arranque_general('[]')::text, true);
insert into _tap (l) select is(
  (current_setting('t.r')::jsonb->>'ok') || '/' || (current_setting('t.r')::jsonb->>'reanudadas'),
  'true/0', 'arranque con lista vacía: ok sin reanudar');
reset role;
insert into _tap (l) select is(
  (select count(*)::int from produccion.pausas_generales where fin is null) || '/' ||
  (select estado from produccion.fabricaciones where id = '00000000-0000-0000-0000-000000000541') || '/' ||
  (select string_agg(estado, ',' order by id) from produccion.envasados
   where id in ('00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-000000000552')),
  '0/pausada/pausado,pausado', 'la lista vacía cierra la pausa y las órdenes quedan pausadas');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.arranque_general('[]')->>'codigo', 'SIN_PAUSA_GENERAL', 'sin pausa abierta: SIN_PAUSA_GENERAL');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into _tap (l) select is(
  produccion.arranque_general('[]')->>'codigo', 'NO_AUTORIZADO', 'planta no puede hacer el arranque');
reset role;

-- Alertas (sección 3) -------------------------------------------------------------
-- Como postgres; el reloj se mueve con eventos con «at» en el pasado. Pausa cerrada al llegar acá.
--   F_P14 …561 (T-PG3): iniciada hace 20 h, pausa de 14 h → 6 h efectivas
--   F_P2  …562 (T-PG4): iniciada hace 20 h, pausa de 2 h → 18 h efectivas
--   F_R   …563 (T-PG5): iniciada hace 20 h, pausa de 7 h antes del rechazo de hace 10 h → 10 h
--   F_E   …564 (T-PG6, para_envasar) con los envasados:
--     V_P10 …571 (activo, iniciado hace 12 h, 10 h de pausa) · V_LEG …572 (activo hace 10 h, sin eventos)
--     V_P1  …574 (activo, iniciado hace 12 h, 1 h de pausa) · V_PZ …573 (pausado hace 2 h)
insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-000000000503', 'T-PG3', 2000, 3),
  ('00000000-0000-0000-0000-000000000504', 'T-PG4', 2000, 4),
  ('00000000-0000-0000-0000-000000000505', 'T-PG5', 2000, 5),
  ('00000000-0000-0000-0000-000000000506', 'T-PG6', 2000, 6);
insert into produccion.fabricaciones (id, tanque_id, producto_id, litros, estado, inicio) values
  ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now() - interval '20 hours'),
  ('00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now() - interval '20 hours'),
  ('00000000-0000-0000-0000-000000000563', '00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-0000000000d1', 500, 'fabricando', now() - interval '20 hours'),
  ('00000000-0000-0000-0000-000000000564', '00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-0000000000d1', 1000, 'para_envasar', now() - interval '22 hours');
insert into produccion.envasados (id, fabricacion_id, presentacion_id, cantidad, estado, inicio) values
  ('00000000-0000-0000-0000-000000000571', '00000000-0000-0000-0000-000000000564', '00000000-0000-0000-0000-0000000000f1', 10, 'activo', now() - interval '12 hours'),
  ('00000000-0000-0000-0000-000000000572', '00000000-0000-0000-0000-000000000564', '00000000-0000-0000-0000-0000000000f1', 10, 'activo', now() - interval '10 hours'),
  ('00000000-0000-0000-0000-000000000573', '00000000-0000-0000-0000-000000000564', '00000000-0000-0000-0000-0000000000f1', 10, 'pausado', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-000000000574', '00000000-0000-0000-0000-000000000564', '00000000-0000-0000-0000-0000000000f1', 10, 'activo', now() - interval '12 hours');
insert into produccion.eventos (entidad, entidad_id, accion, at) values
  ('fabricacion', '00000000-0000-0000-0000-000000000561', 'iniciar',   now() - interval '20 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000561', 'pausar',    now() - interval '18 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000561', 'reanudar',  now() - interval '4 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000562', 'iniciar',   now() - interval '20 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000562', 'pausar',    now() - interval '18 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000562', 'reanudar',  now() - interval '16 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000563', 'iniciar',   now() - interval '20 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000563', 'pausar',    now() - interval '19 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000563', 'reanudar',  now() - interval '12 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000563', 'finalizar', now() - interval '11 hours'),
  ('fabricacion', '00000000-0000-0000-0000-000000000563', 'rechazar',  now() - interval '10 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000571', 'iniciar',   now() - interval '12 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000571', 'pausar',    now() - interval '11 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000571', 'reanudar',  now() - interval '1 hour'),
  ('envasado',    '00000000-0000-0000-0000-000000000573', 'iniciar',   now() - interval '3 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000573', 'pausar',    now() - interval '2 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000574', 'iniciar',   now() - interval '12 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000574', 'pausar',    now() - interval '11 hours'),
  ('envasado',    '00000000-0000-0000-0000-000000000574', 'reanudar',  now() - interval '10 hours');

-- Con una pausa general abierta no se crea ninguna alerta
insert into produccion.pausas_generales (iniciada_por) values ('00000000-0000-0000-0000-0000000000a1');
insert into _tap (l) select is(produccion.revisar_alertas(), 0, 'con pausa general abierta revisar_alertas devuelve 0');
insert into _tap (l) select is(
  (select count(*)::int from produccion.alertas
   where entidad_id in ('00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000573')),
  0, 'con pausa general abierta: ni pausa_larga ni exceso_9h');
update produccion.pausas_generales set fin = now() where fin is null;

select produccion.revisar_alertas();
insert into _tap (l) select ok(
  not exists (select 1 from produccion.alertas where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-000000000561'),
  'fabricación de 20 h con 14 h de pausa: sin exceso_9h');
insert into _tap (l) select ok(
  exists (select 1 from produccion.alertas where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-000000000562'),
  'fabricación de 20 h con 2 h de pausa: exceso_9h');
insert into _tap (l) select ok(
  exists (select 1 from produccion.alertas where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-000000000563'),
  'fabricación rechazada hace 10 h: exceso_9h (la pausa anterior al rechazo no descuenta)');
insert into _tap (l) select ok(
  not exists (select 1 from produccion.alertas where tipo = 'exceso_9h' and entidad_id = '00000000-0000-0000-0000-000000000571'),
  'envasado de 12 h con 10 h de pausa: sin exceso_9h');
insert into _tap (l) select is(
  (select round(min_pausa)::int from produccion.v_tiempos_efectivos
   where entidad = 'envasado' and entidad_id = '00000000-0000-0000-0000-000000000571'),
  600, 'v_tiempos_efectivos: el envasado tiene 600 min de pausa');
insert into _tap (l) select is(
  (select count(*)::int from produccion.alertas where tipo = 'exceso_9h'
   and entidad_id in ('00000000-0000-0000-0000-000000000572', '00000000-0000-0000-0000-000000000574')),
  2, 'envasado de 11 h efectivas y envasado viejo sin eventos (reloj desde inicio): exceso_9h');
insert into _tap (l) select ok(
  exists (select 1 from produccion.alertas where tipo = 'pausa_larga' and entidad_id = '00000000-0000-0000-0000-000000000573'),
  'cerrada la pausa general, la pausa larga se alerta');

insert into _tap (l) select * from finish();
select l from _tap order by n;
rollback;
