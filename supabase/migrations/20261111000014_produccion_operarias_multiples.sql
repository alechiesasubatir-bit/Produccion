-- ProdControl · 014 — varias operarias por orden (participaciones), etiquetas y vencimiento
-- Secciones: 1. Esquema · 2. RPC · 3. Vistas · migración de datos al final.

-- 1. Esquema -----------------------------------------------------------------

create table produccion.participaciones (
  id                  uuid primary key default gen_random_uuid(),
  entidad             text not null check (entidad in ('fabricacion', 'envasado', 'fraccionado')),
  entidad_id          uuid not null,  -- sin FK, como eventos
  empleado_id         uuid not null references produccion.operarias (empleado_id),
  desde               timestamptz not null default now(),
  hasta               timestamptz,
  cantidad            numeric check (cantidad > 0),
  unidad              text check (unidad in ('L', 'kg')),
  cantidad_corregida  numeric check (cantidad_corregida > 0),
  corregida_por       uuid references auth.users (id) on delete set null,
  corregida_at        timestamptz
);
create unique index participaciones_abierta_uk
  on produccion.participaciones (entidad, entidad_id, empleado_id) where hasta is null;
create index participaciones_entidad_idx on produccion.participaciones (entidad, entidad_id);
create index participaciones_empleado_idx on produccion.participaciones (empleado_id);
create index participaciones_corregida_por_idx on produccion.participaciones (corregida_por);

alter table produccion.participaciones enable row level security;
grant select on produccion.participaciones to authenticated;
create policy participaciones_leer on produccion.participaciones for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));

-- Etiquetas (catálogo, como presentaciones)
create table produccion.etiquetas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table produccion.etiquetas enable row level security;
grant select, insert, update, delete on produccion.etiquetas to authenticated;
create policy etiquetas_leer on produccion.etiquetas for select to authenticated
  using ((select produccion.es_panel()) or (select produccion.es_planta()));
create policy etiquetas_crear on produccion.etiquetas for insert to authenticated
  with check ((select produccion.es_panel()));
create policy etiquetas_editar on produccion.etiquetas for update to authenticated
  using ((select produccion.es_panel())) with check ((select produccion.es_panel()));
create policy etiquetas_borrar on produccion.etiquetas for delete to authenticated
  using ((select produccion.es_panel()));

alter table produccion.envasados add column etiqueta_id uuid references produccion.etiquetas (id);
alter table produccion.fraccionados add column etiqueta_id uuid references produccion.etiquetas (id);
create index envasados_etiqueta_idx on produccion.envasados (etiqueta_id);
create index fraccionados_etiqueta_idx on produccion.fraccionados (etiqueta_id);

grant insert (etiqueta_id), update (etiqueta_id) on produccion.envasados to authenticated;
grant insert (etiqueta_id), update (etiqueta_id) on produccion.fraccionados to authenticated;

-- No se puede asignar una etiqueta desactivada (la que ya tenía la orden se conserva).
create function produccion._validar_etiqueta() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.etiqueta_id is not null
     and (tg_op = 'INSERT' or new.etiqueta_id is distinct from old.etiqueta_id)
     and not exists (select 1 from produccion.etiquetas e where e.id = new.etiqueta_id and e.activo) then
    raise exception using errcode = 'PC001', message = 'ETIQUETA_INACTIVA';
  end if;
  return new;
end $$;
revoke execute on function produccion._validar_etiqueta() from public, anon, authenticated;

create trigger envasados_validar_etiqueta before insert or update of etiqueta_id on produccion.envasados
  for each row execute function produccion._validar_etiqueta();
create trigger fraccionados_validar_etiqueta before insert or update of etiqueta_id on produccion.fraccionados
  for each row execute function produccion._validar_etiqueta();

-- Eventos nuevos
alter table produccion.eventos drop constraint eventos_accion_check;
alter table produccion.eventos add constraint eventos_accion_check
  check (accion in ('crear', 'iniciar', 'pausar', 'reanudar', 'finalizar', 'cancelar', 'editar',
                    'sumarse', 'salir', 'corregir'));

alter publication supabase_realtime add table produccion.participaciones, produccion.etiquetas;

-- Helper interno: abre una participación si la operaria no tiene una abierta en la orden.
create function produccion._abrir_participacion(p_entidad text, p_id uuid, p_empleado uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_empleado is null then return; end if;
  insert into produccion.participaciones (entidad, entidad_id, empleado_id)
  values (p_entidad, p_id, p_empleado)
  on conflict (entidad, entidad_id, empleado_id) where hasta is null do nothing;
end $$;
revoke execute on function produccion._abrir_participacion(text, uuid, uuid) from public, anon, authenticated;

-- Migración de datos: órdenes en curso con operaria → participación abierta desde el inicio.
-- Idempotente (no duplica si ya hay una abierta).
create function produccion._migrar_participaciones() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select 'fabricacion' as entidad, id, operaria_id as empleado_id, inicio
      from produccion.fabricaciones where estado in ('fabricando', 'pausada') and operaria_id is not null
    union all
    select 'envasado', id, operaria_1, inicio
      from produccion.envasados where estado in ('activo', 'pausado') and operaria_1 is not null
    union all
    select 'envasado', id, operaria_2, inicio
      from produccion.envasados where estado in ('activo', 'pausado') and operaria_2 is not null
    union all
    select 'fraccionado', id, operaria_id, inicio
      from produccion.fraccionados where estado in ('activo', 'pausado') and operaria_id is not null
  loop
    insert into produccion.participaciones (entidad, entidad_id, empleado_id, desde)
    values (r.entidad, r.id, r.empleado_id, coalesce(r.inicio, now()))
    on conflict (entidad, entidad_id, empleado_id) where hasta is null do nothing;
  end loop;
end $$;
revoke execute on function produccion._migrar_participaciones() from public, anon, authenticated;

-- 2. RPC ---------------------------------------------------------------------

-- 3. Vistas ------------------------------------------------------------------

-- Migración de datos (siempre al final del archivo) ---------------------------
select produccion._migrar_participaciones();
