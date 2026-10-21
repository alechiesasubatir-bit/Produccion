-- ProdControl · 001 — esquema produccion: tablas
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

-- Rol del usuario en ProdControl (mismo patrón que rol_mantenimiento).
-- panel = encargada (además de perfiles.rol = 'admin'); planta = usuario-dispositivo (tablet).
alter table public.perfiles
  add column if not exists rol_produccion text
  constraint perfiles_rol_produccion_ck check (rol_produccion in ('panel', 'planta'));

create schema if not exists produccion;
grant usage on schema produccion to authenticated;

-- Catálogos ---------------------------------------------------------------

create table produccion.productos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique,
  color           text not null default '#0284c7' check (color ~ '^#[0-9a-fA-F]{6}$'),
  tipo            text not null default 'liquido' check (tipo in ('liquido', 'denso', 'polvo')),
  litros_hora_std numeric check (litros_hora_std > 0),
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table produccion.presentaciones (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null unique,
  litros_equiv numeric not null check (litros_equiv > 0),
  activo       boolean not null default true
);

create table produccion.tanques (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  capacidad_l numeric not null check (capacidad_l > 0),
  orden       int not null default 0,
  activo      boolean not null default true
);

create table produccion.operarias (
  empleado_id         uuid primary key references core.funcionarios (id),
  categoria           text,
  color_avatar        text,
  pin_hash            text,
  pin_intentos        int not null default 0,
  pin_bloqueado_hasta timestamptz,
  activo              boolean not null default true
);

-- Trabajo -----------------------------------------------------------------

create table produccion.fabricaciones (
  id          uuid primary key default gen_random_uuid(),
  tanque_id   uuid not null references produccion.tanques (id),
  producto_id uuid not null references produccion.productos (id),
  litros      numeric not null check (litros > 0),
  lote        text,
  estado      text not null default 'cola'
              check (estado in ('cola', 'fabricando', 'pausada', 'para_envasar', 'finalizada', 'cancelada')),
  operaria_id uuid references produccion.operarias (empleado_id),
  inicio      timestamptz,
  fin         timestamptz,
  creado_por  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index fabricaciones_tanque_abierta_uk on produccion.fabricaciones (tanque_id)
  where estado in ('cola', 'fabricando', 'pausada', 'para_envasar');
create index fabricaciones_producto_idx on produccion.fabricaciones (producto_id);
create index fabricaciones_operaria_idx on produccion.fabricaciones (operaria_id);
create index fabricaciones_creado_por_idx on produccion.fabricaciones (creado_por);

create table produccion.envasados (
  id              uuid primary key default gen_random_uuid(),
  fabricacion_id  uuid not null references produccion.fabricaciones (id),
  presentacion_id uuid not null references produccion.presentaciones (id),
  cantidad        int not null check (cantidad > 0),
  etiquetado      text,
  operaria_1      uuid references produccion.operarias (empleado_id),
  operaria_2      uuid references produccion.operarias (empleado_id),
  estado          text not null default 'cola'
                  check (estado in ('cola', 'activo', 'pausado', 'finalizado', 'cancelado')),
  inicio          timestamptz,
  fin             timestamptz,
  creado_por      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index envasados_fabricacion_idx on produccion.envasados (fabricacion_id);
create index envasados_presentacion_idx on produccion.envasados (presentacion_id);
create index envasados_operaria_1_idx on produccion.envasados (operaria_1);
create index envasados_operaria_2_idx on produccion.envasados (operaria_2);
create index envasados_creado_por_idx on produccion.envasados (creado_por);

create table produccion.fraccionados (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null,
  descripcion     text,
  producto_id     uuid references produccion.productos (id),
  presentacion_id uuid references produccion.presentaciones (id),
  cantidad        int not null check (cantidad > 0),
  lote            text,
  etiquetado      text,
  operaria_id     uuid references produccion.operarias (empleado_id),
  estado          text not null default 'cola'
                  check (estado in ('cola', 'activo', 'pausado', 'finalizado', 'cancelado')),
  inicio          timestamptz,
  fin             timestamptz,
  creado_por      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index fraccionados_producto_idx on produccion.fraccionados (producto_id);
create index fraccionados_presentacion_idx on produccion.fraccionados (presentacion_id);
create index fraccionados_operaria_idx on produccion.fraccionados (operaria_id);
create index fraccionados_creado_por_idx on produccion.fraccionados (creado_por);

-- Historial: sin FKs a propósito, sobrevive a cambios en catálogos y usuarios.
create table produccion.eventos (
  id          bigserial primary key,
  entidad     text not null check (entidad in ('fabricacion', 'envasado', 'fraccionado')),
  entidad_id  uuid not null,
  accion      text not null
              check (accion in ('crear', 'iniciar', 'pausar', 'reanudar', 'finalizar', 'cancelar', 'editar')),
  empleado_id uuid,
  usuario_id  uuid,
  dispositivo text,
  at          timestamptz not null default now(),
  datos       jsonb not null default '{}'
);
create index eventos_entidad_idx on produccion.eventos (entidad, entidad_id, at);
create index eventos_at_idx on produccion.eventos (at);

create table produccion.alertas (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('exceso_9h', 'desvio_estandar')),
  entidad         text check (entidad in ('fabricacion', 'envasado', 'fraccionado')),
  entidad_id      uuid,
  texto           text not null,
  creada          timestamptz not null default now(),
  leida           boolean not null default false,
  pospuesta_hasta timestamptz
);

-- RLS activo desde el inicio (sin políticas = nadie accede); las políticas llegan en 002.
alter table produccion.productos      enable row level security;
alter table produccion.presentaciones enable row level security;
alter table produccion.tanques        enable row level security;
alter table produccion.operarias      enable row level security;
alter table produccion.fabricaciones  enable row level security;
alter table produccion.envasados      enable row level security;
alter table produccion.fraccionados   enable row level security;
alter table produccion.eventos        enable row level security;
alter table produccion.alertas        enable row level security;
