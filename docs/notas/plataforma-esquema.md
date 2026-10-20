# Plataforma — relevamiento de esquema (2026-10-20)

## Usar en el plan:

| Plan dice | Real |
|---|---|
| `core.empleados(id uuid)` | **`core.funcionarios(id uuid)`** |
| empleado activo | `funcionarios.estado <> 'baja'` (estados: activo, baja, licencia, vacaciones, certificacion_medica) |
| nombre / foto | `funcionarios.nombre` (nombre completo) / `funcionarios.foto_url` |
| `public.profiles` | **`public.perfiles`** |
| `profiles.role = 'admin'` | `perfiles.rol = 'admin'` |
| `'produccion' = any(profiles.modules)` | `perfiles.rol_produccion = 'panel'` (columna nueva, decisión del usuario) |
| `'produccion_planta' = any(profiles.modules)` | `perfiles.rol_produccion = 'planta'` |
| `profiles.activo` | `perfiles.activo` |

## Proyecto

- Nombre: **Plataforma** · project_id `iyqufnmpjkyfzspujwyf` · Postgres 17 · us-west-1.
- Otros proyectos de la org (no tocar): Compras Subatir SA, Mantenimiento, Producción (`gyxycdiklvadorgrynhl`, app vieja).

## Tablas relevantes

- `core.funcionarios` — id uuid (default `uuid_generate_v4()`), nombre text!, cedula text!, cargo text!, sector text! (36 en "Producción"), estado text! default 'activo', foto_url text, …
  RLS: select `true` para autenticados; insert/update/delete solo `obtener_rol_usuario() = 'admin'`.
- `public.perfiles` — id uuid (= auth.users.id), rol text! default 'viewer' (valores en uso: admin, sin_acceso), nombre, email, activo bool! default true, rol_mantenimiento text, equipo_id text.
  Se crea por trigger `crear_perfil_usuario` (rol 'sin_acceso') al alta en auth.users.
  RLS: el usuario lee su fila; admin lee/edita todo.
- `public.perfiles_usuario`, `public.unif_*` — no relevantes.

## Helpers existentes

- `public.obtener_rol_usuario() returns text` — security definer, `select rol from perfiles where id = auth.uid()`.
- Patrón por módulo: columna `perfiles.rol_<modulo>` (Mantenimiento usa `rol_mantenimiento`).

## Extensiones

- Instaladas: pgcrypto (schema `extensions`), uuid-ossp, pg_stat_statements, supabase_vault.
- Faltantes: **pgtap** (se instala en `extensions`, OK del usuario), pg_cron (plan 4).
- `crypt`/`gen_salt` se llaman como `extensions.crypt(...)` (funciones con `search_path = ''`).

## Esquemas

- Existentes: public, core, compras, rrhh, mantenimiento, + los de Supabase.
- Expuestos por la API: se configura en Studio → Settings → API (no visible por SQL). **`produccion` debe agregarse ahí.**
- Publicación `supabase_realtime`: hoy solo `mantenimiento.mensajes`.
