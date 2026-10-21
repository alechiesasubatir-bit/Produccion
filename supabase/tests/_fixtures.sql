-- Datos de prueba. Se concatena al inicio de cada *.test.sql, dentro de su begin … rollback.
-- Ids fijos:
--   funcionarios  E1 …e1 (Laura Paz) · E2 …e2 (Rosa Díaz) · E3 …e3 (baja)
--   usuarios      U_PANEL …a1 · U_TABLET …a2 · U_OTRO …a3
--   tanque T-TEST …c1 · producto Lavandina-test …d1 · presentación 5L-test …f1

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'test-panel@prodcontrol.test',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'test-tablet@prodcontrol.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'test-otro@prodcontrol.test',   'authenticated', 'authenticated');
-- trigger_crear_perfil crea las filas de perfiles con rol 'sin_acceso'
update public.perfiles set rol_produccion = 'panel'  where id = '00000000-0000-0000-0000-0000000000a1';
update public.perfiles set rol_produccion = 'planta' where id = '00000000-0000-0000-0000-0000000000a2';

insert into core.funcionarios (id, nombre, cedula, fecha_ingreso, cargo, sector, tipo_contrato, estado) values
  ('00000000-0000-0000-0000-0000000000e1', 'Laura Paz',  'TEST-E1', current_date, 'Operaria', 'Producción', 'indefinido', 'activo'),
  ('00000000-0000-0000-0000-0000000000e2', 'Rosa Díaz',  'TEST-E2', current_date, 'Operaria', 'Producción', 'indefinido', 'activo'),
  ('00000000-0000-0000-0000-0000000000e3', 'Ana Baja',   'TEST-E3', current_date, 'Operaria', 'Producción', 'indefinido', 'baja');

insert into produccion.operarias (empleado_id, categoria, color_avatar, pin_hash) values
  ('00000000-0000-0000-0000-0000000000e1', 'A', '#db2777', extensions.crypt('1234', extensions.gen_salt('bf'))),
  ('00000000-0000-0000-0000-0000000000e2', 'A', '#0284c7', extensions.crypt('1234', extensions.gen_salt('bf'))),
  ('00000000-0000-0000-0000-0000000000e3', 'B', '#65a30d', extensions.crypt('1234', extensions.gen_salt('bf')));

insert into produccion.tanques (id, codigo, capacidad_l, orden) values
  ('00000000-0000-0000-0000-0000000000c1', 'T-TEST', 2000, 1);
insert into produccion.productos (id, nombre, color, tipo) values
  ('00000000-0000-0000-0000-0000000000d1', 'Lavandina-test', '#0284c7', 'liquido');
insert into produccion.presentaciones (id, nombre, litros_equiv) values
  ('00000000-0000-0000-0000-0000000000f1', '5L-test', 5);

-- Salida TAP: execute_sql solo devuelve el último resultado, así que cada aserción
-- se inserta en _tap y el test termina con `select l from _tap order by n`.
create temp table _tap (n serial, l text) on commit drop;
