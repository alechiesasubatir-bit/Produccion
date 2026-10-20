# ProdControl · Plan 1 — Fundación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar la base de ProdControl funcionando: esquema `produccion` en Supabase (tablas, RLS, RPC `accion`, vistas) probado, y una app Vite+React publicable con login, rutas `/panel` y `/planta`, el componente `<Tanque>` y una pared de tanques en vivo.

**Architecture:** Toda regla de negocio vive en Postgres (RPC `security definer` + RLS); el front solo lee tablas/vistas y llama RPCs. El front es una SPA React con rutas protegidas por rol, estilos con CSS variables y animación del tanque en SVG/CSS.

**Tech Stack:** Supabase (Postgres 15+, pgcrypto, pgTAP, Realtime) vía MCP · Vite 5 · React 18 · TypeScript 5 · react-router 6 · motion (Framer Motion) · Vitest + @testing-library/react + jsdom · GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-20-prodcontrol-rediseno-design.md`

**Roadmap (planes siguientes, se escriben al terminar este):** 2 · Tablet `/planta` — 3 · PC `/panel` operativa (Flujo, Nueva orden, Tanques, Configuración) — 4 · Análisis (Historial, KPIs, Alertas+pg_cron, CSV, Edge Function escanear-hoja).

## Global Constraints

- Proyecto Supabase: **plataforma** (org subatirapps-a11y). Todo lo nuevo en el esquema **`produccion`**; `core.*` y `profiles` son **solo lectura** para este plan.
- **Aplicar una migración al proyecto plataforma es una acción en producción: pedir confirmación al usuario antes de cada `apply_migration`.** Los tests SQL corren dentro de `begin … rollback`.
- Las operarias son siempre empleados de `core`; `produccion.operarias.empleado_id` referencia la tabla de empleados real (nombre confirmado en Task 1; provisorio `core.empleados`, tipo `uuid`). Si Task 1 encuentra otro nombre/tipo, usarlo en todo el plan.
- Panel = `profiles.role = 'admin'` **o** `'produccion' = any(profiles.modules)`. Dispositivo de planta = `'produccion_planta' = any(profiles.modules)`.
- PIN: 4 dígitos, hash `crypt(pin, gen_salt('bf'))`; 5 fallos → `pin_bloqueado_hasta = now() + interval '1 minute'`.
- Estados — fabricación: `cola · fabricando · pausada · para_envasar · finalizada · cancelada`; envasado y fraccionado: `cola · activo · pausado · finalizado · cancelado`.
- Códigos de error de RPC (en `message`): `NO_AUTORIZADO`, `PIN_INCORRECTO`, `PIN_BLOQUEADO`, `OPERARIA_INACTIVA`, `TRANSICION_INVALIDA`, `OPERARIA_OCUPADA`, `TANQUE_NO_LISTO`, `NO_ENCONTRADO`. Detalle humano en `detail`.
- Paleta: papel `#f5f6f2`, papel-2 `#eceee6`, tarjeta `#ffffff`, tinta `#0f172a`, líneas `#e3e5dc`. Fuentes: Fraunces, Geist, Geist Mono (Google Fonts).
- `prefers-reduced-motion: reduce` → sin olas, burbujas ni transiciones.
- Node ≥ 20. Textos de UI en español rioplatense.

## Review Focus

1. **Dos personas finalizan la misma tarea casi a la vez** → la segunda recibe `TRANSICION_INVALIDA` con detalle "ya la finalizó <nombre> a las HH:MM", nunca un doble evento. (Test en Task 5.)
2. **PIN bloqueado** → durante el minuto de bloqueo, incluso el PIN correcto devuelve `PIN_BLOQUEADO`; tras un acierto, `pin_intentos` vuelve a 0. (Test en Task 5.)
3. **Se envasa más de lo fabricado** (litros_equiv × cantidad > litros) → la fabricación igual se cierra y `litros_restantes` nunca es negativo en la vista. (Tests en Task 5 y Task 6.)
4. **Empleado desactivado en `core`** → desaparece de `v_operarias` y la RPC devuelve `OPERARIA_INACTIVA`. (Tests en Task 4 y Task 5.)
5. **El usuario-dispositivo intenta escribir tablas directo** (insert/update vía API) → RLS lo rechaza; solo la RPC funciona. (Test en Task 4.)

---

## File Structure

```
.gitignore  .env.example  package.json  vite.config.ts  tsconfig.json  index.html
public/404.html                          # redirect SPA para GitHub Pages
.github/workflows/deploy.yml
docs/notas/plataforma-esquema.md         # hallazgos de Task 1
supabase/migrations/
  20261020000001_produccion_tablas.sql
  20261020000002_produccion_rls.sql
  20261020000003_produccion_rpc.sql
  20261020000004_produccion_vistas.sql
supabase/tests/
  _fixtures.sql                          # usuarios/empleados de prueba (dentro de la tx)
  tablas.test.sql  rls.test.sql  rpc.test.sql  vistas.test.sql
src/
  main.tsx  App.tsx
  lib/supabase.ts          # cliente + fetchAll
  lib/database.types.ts    # generado por MCP
  lib/errores.ts           # código RPC → mensaje humano
  lib/useRealtime.ts       # hook lectura + suscripción
  domain/tanque.ts         # nivel, burbujas, pausa (puro)
  domain/acciones.ts       # acciones posibles por entidad/estado (puro)
  auth/useSesion.ts  auth/RequireRol.tsx  auth/Login.tsx
  ui/tokens.css  ui/Tanque.tsx  ui/Tanque.css  ui/Chip.tsx
  pages/PanelInicio.tsx  pages/PlantaInicio.tsx   # placeholders con pared de tanques
  **/*.test.ts(x)
```

---

### Task 1: Relevar el esquema de plataforma

**Files:**
- Create: `docs/notas/plataforma-esquema.md`

**Interfaces:**
- Produces: nombre y columnas reales de la tabla de empleados (id, nombre, apellido/nombre completo, foto, activo), columnas de `profiles` (`id`, `role`, `modules`, `activo`), funciones helper de rol existentes, esquemas expuestos, extensiones instaladas (`pgcrypto`, `pgtap`, `pg_cron`).

- [ ] **Step 1: Verificar que el MCP de Supabase está disponible** — `ToolSearch("supabase")`; si no aparecen tools, detenerse y pedir al usuario reiniciar Claude Code y autenticar con `/mcp`.
- [ ] **Step 2: Identificar el proyecto** — `list_projects`; anotar `project_id` de **plataforma** en la nota.
- [ ] **Step 3: Leer esquema** — `list_tables(schemas: ['core','public'])`, `list_extensions`, y `execute_sql`:
  `select routine_schema, routine_name from information_schema.routines where routine_schema in ('public','core') and routine_name ilike any (array['%role%','%modul%','%admin%']);`
- [ ] **Step 4: Escribir `docs/notas/plataforma-esquema.md`** con: project_id, tabla de empleados (nombre, columnas, tipo del id, columna de activo, de foto), `profiles` (columnas), helpers RLS existentes, extensiones presentes/faltantes, esquemas expuestos.
- [ ] **Step 5: Si el nombre/tipo de empleados difiere de `core.empleados uuid`** — anotar el reemplazo arriba de la nota bajo "Usar en el plan:". Avisar al usuario de cualquier extensión faltante (`pgtap`, `pgcrypto`) antes de seguir.

---

### Task 2: Repo y scaffold

**Files:**
- Create: `.gitignore` (incluye `node_modules`, `dist`, `.env`, `.superpowers/`), `.env.example` (`VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`), `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/smoke.test.ts`

**Interfaces:**
- Produces: scripts `npm run dev | build | test | typecheck`; `vite.config.ts` con `base: '/Produccion/'` y `test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'] }`.

- [ ] **Step 1: `git init`** en `C:\SubatirApps\Produccion` y crear `.gitignore`.
- [ ] **Step 2: Scaffold** — `npm create vite@latest . -- --template react-ts`, luego `npm i @supabase/supabase-js react-router-dom motion` y `npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom`. Crear `src/test-setup.ts` importando `@testing-library/jest-dom/vitest`.
- [ ] **Step 3: Test de humo** — `src/smoke.test.ts`: `expect(1 + 1).toBe(2)`.
- [ ] **Step 4: Verificar** — `npm test -- --run` → PASS; `npm run build` → genera `dist/` sin errores.
- [ ] **Step 5: Commit** — incluir la spec y este plan.

```bash
git add -A && git commit -m "chore: scaffold ProdControl (Vite+React+TS) con spec y plan 1"
```

---

### Task 3: Migración 001 — tablas

**Files:**
- Create: `supabase/migrations/20261020000001_produccion_tablas.sql`, `supabase/tests/_fixtures.sql`, `supabase/tests/tablas.test.sql`

**Interfaces:**
- Produces: tablas de spec §4.1 y §4.2 con exactamente estos nombres/columnas; ids `uuid default gen_random_uuid()` (salvo `eventos.id bigserial` y `operarias.empleado_id`); `check` de estados con los valores de Global Constraints; `tanques.codigo unique`; índice único parcial `fabricaciones_tanque_abierta_uk on fabricaciones(tanque_id) where estado in ('cola','fabricando','pausada','para_envasar')`; `operarias.pin_intentos int not null default 0`; timestamps `timestamptz`; FKs: `fabricaciones.tanque_id→tanques`, `producto_id→productos`, `operaria_id→operarias(empleado_id)`, `envasados.fabricacion_id→fabricaciones`, `presentacion_id→presentaciones`, `operaria_1/2→operarias`, `fraccionados.operaria_id→operarias`, `operarias.empleado_id→core.empleados(id)`.
- `_fixtures.sql` produce (dentro de la transacción): empleados `E1` (activo, "Laura Paz"), `E2` (activo, "Rosa Díaz"), `E3` (inactivo); usuarios auth `U_PANEL` (módulo `produccion`), `U_TABLET` (módulo `produccion_planta`), `U_OTRO` (sin módulos); operarias E1/E2/E3 con PIN `1234`; tanque `T-01` (2000 L); producto `Lavandina` (`#0284c7`); presentación `5L` (5 L). Ids fijos como literales uuid (p. ej. `00000000-0000-0000-0000-0000000000e1`) para referenciarlos en los tests. `execute_sql` no soporta `\i`: cada test se ejecuta concatenando `_fixtures.sql` + el archivo de test.

- [ ] **Step 1: Escribir `tablas.test.sql` (pgTAP)** — `begin; <contenido de _fixtures.sql> select plan(4);`
  - `has_table('produccion','eventos')`
  - `throws_ok` al insertar una segunda fabricación en `T-01` con estado `cola` cuando ya existe una en `fabricando` → `23505`
  - `lives_ok` insertar segunda fabricación en `T-01` si la primera está `finalizada`
  - `throws_ok` estado `'terminada'` en fabricaciones → `23514`
  `select * from finish(); rollback;`
- [ ] **Step 2: Correr y ver fallar** — `execute_sql` con el contenido (fixtures inline) → falla: schema `produccion` no existe.
- [ ] **Step 3: Escribir la migración** — `create schema produccion; grant usage on schema produccion to authenticated;` + tablas. `create extension if not exists pgcrypto;`
- [ ] **Step 4: Pedir confirmación al usuario y aplicar** — `apply_migration(name: 'produccion_tablas', query: <archivo>)`.
- [ ] **Step 5: Correr test** — `execute_sql` → `ok 1..4`, sin `not ok`.
- [ ] **Step 6: Commit** — `git commit -m "feat(db): esquema produccion — tablas"`

---

### Task 4: Migración 002 — helpers de rol, RLS y `v_operarias`

**Files:**
- Create: `supabase/migrations/20261020000002_produccion_rls.sql`, `supabase/tests/rls.test.sql`

**Interfaces:**
- Produces:
  - `produccion.es_panel() returns boolean` y `produccion.es_planta() returns boolean` — `stable security definer set search_path = ''`, leen `public.profiles` de `auth.uid()` (perfil `activo`).
  - RLS habilitado en todas las tablas `produccion.*`. Políticas: `select` para `es_panel() or es_planta()` en catálogos, trabajo, eventos, alertas; `insert/update/delete` solo `es_panel()` en catálogos, trabajo y alertas; `eventos` sin políticas de escritura (solo RPC).
  - `operarias`: sin `select` directo para nadie salvo `es_panel()`; `revoke select (pin_hash, pin_intentos, pin_bloqueado_hasta) on produccion.operarias from authenticated`.
  - Vista `produccion.v_operarias` (`security_invoker = false`, owner postgres) → `empleado_id, nombre, foto_url, categoria, color_avatar, activo` solo donde `operarias.activo and empleado.activo`, filtrada por `es_panel() or es_planta()` en el `where`.
  - Agregar `produccion` a los esquemas expuestos de la API (vía `execute_sql`/config del proyecto o pedir al usuario hacerlo en Studio → Settings → API).

- [ ] **Step 1: Escribir `rls.test.sql`** — usando `set local role authenticated; set local request.jwt.claims = '{"sub":"<U_x>"}'` por bloque. `plan(6)`:
  - como `U_TABLET`: `throws_ok` insert en `produccion.fabricaciones` → `42501`
  - como `U_TABLET`: `results_eq` `select count(*) from produccion.tanques` → `1`
  - como `U_TABLET`: `throws_ok` `select pin_hash from produccion.operarias` → `42501`
  - como `U_TABLET`: `results_eq` `select count(*) from produccion.v_operarias` → `2` (E3 inactivo excluido)
  - como `U_PANEL`: `lives_ok` insert de fabricación en `T-01`
  - como `U_OTRO`: `results_eq` `select count(*) from produccion.tanques` → `0`
- [ ] **Step 2: Correr y ver fallar** (funciones/vista inexistentes).
- [ ] **Step 3: Escribir la migración.**
- [ ] **Step 4: Confirmar con el usuario y aplicar** — `apply_migration('produccion_rls', …)`; luego `get_advisors(type:'security')` y resolver cualquier aviso sobre objetos de `produccion`.
- [ ] **Step 5: Correr test** → `ok 1..6`.
- [ ] **Step 6: Commit** — `git commit -m "feat(db): RLS, helpers de rol y v_operarias"`

---

### Task 5: Migración 003 — RPC `set_pin` y `accion`

**Files:**
- Create: `supabase/migrations/20261020000003_produccion_rpc.sql`, `supabase/tests/rpc.test.sql`

**Interfaces:**
- Produces:
  - `produccion.set_pin(p_empleado_id uuid, p_pin text) returns void` — solo `es_panel()`; valida `^\d{4}$`; resetea `pin_intentos`/`pin_bloqueado_hasta`.
  - `produccion.accion(p_entidad text, p_id uuid, p_accion text, p_empleado_id uuid default null, p_pin text default null) returns jsonb` — `security definer`, `set search_path = ''`. `p_entidad ∈ ('fabricacion','envasado','fraccionado')`, `p_accion ∈ ('iniciar','pausar','reanudar','finalizar','cancelar')`. Devuelve la fila actualizada como `jsonb` más `"fabricacion_cerrada": bool` para envasados.
  - `grant execute on function produccion.accion, produccion.set_pin to authenticated`.

**Reglas (orden de validación dentro de `accion`):**
1. Ni `es_panel()` ni `es_planta()` → `NO_AUTORIZADO`.
2. Si `es_planta()` y no `es_panel()`: `p_empleado_id` y `p_pin` obligatorios; `cancelar` → `NO_AUTORIZADO`. Operaria inactiva (en `produccion` o `core`) → `OPERARIA_INACTIVA`. `pin_bloqueado_hasta > now()` → `PIN_BLOQUEADO`. PIN incorrecto → `pin_intentos += 1` (si llega a 5: bloquear 1 min y reiniciar intentos) y `PIN_INCORRECTO`; correcto → `pin_intentos = 0`. **Las escrituras de intentos deben persistir aunque la función lance excepción**: validar el PIN en una función auxiliar `produccion._verificar_pin(...) returns text` que no lance (devuelve `'ok'|'incorrecto'|'bloqueado'`), y lanzar desde `accion` después.
3. `select … for update` de la fila; no existe → `NO_ENCONTRADO`.
4. Transiciones válidas (cualquier otra → `TRANSICION_INVALIDA`, `detail` = último evento: "ya la <acción en participio> <nombre> a las HH:MM"):
   - fabricación: `cola→fabricando (iniciar)`, `fabricando→pausada (pausar)`, `pausada→fabricando (reanudar)`, `fabricando→para_envasar (finalizar)`, `cola|fabricando|pausada→cancelada (cancelar)`
   - envasado/fraccionado: `cola→activo (iniciar)`, `activo→pausado`, `pausado→activo`, `activo→finalizado`, `cola|activo|pausado→cancelado`
5. Envasado `iniciar`: fabricación asociada debe estar `para_envasar` → si no, `TANQUE_NO_LISTO`. `iniciar`/`reanudar` de envasado con `p_empleado_id` que figura como `operaria_1/2` en otro envasado `activo` → `OPERARIA_OCUPADA` (`detail` con producto).
6. Efectos: `iniciar` fija `inicio = now()` (si null) y, si `operaria_id`/`operaria_1` es null, la asigna a `p_empleado_id`; `finalizar`/`cancelar` fija `fin = now()`. Insertar en `eventos` (`usuario_id = auth.uid()`, `empleado_id`, `dispositivo` = `profiles.email` si es planta).
7. Envasado `finalizar`: `restantes = fab.litros − Σ(cantidad × presentaciones.litros_equiv)` de envasados `finalizado` de esa fabricación; si `restantes <= 0` → fabricación `finalizada`, `fin = now()`, evento `finalizar` con `empleado_id null` y `datos = {"auto":true}`.

- [ ] **Step 1: Escribir `rpc.test.sql`** — `plan(12)`, como `U_TABLET` salvo indicación:
  - `iniciar` fabricación en `cola` con E1/`1234` → estado `fabricando`, `operaria_id = E1`, 1 fila en `eventos`
  - `finalizar` desde `cola` → `TRANSICION_INVALIDA`
  - E1 PIN `9999` → `PIN_INCORRECTO` y `pin_intentos = 1` (verificado como superusuario tras el bloque)
  - 5 PINs incorrectos y luego `1234` → `PIN_BLOQUEADO`
  - acierto tras errores (<5) → `pin_intentos = 0`
  - E3 (inactivo) → `OPERARIA_INACTIVA`
  - `cancelar` como `U_TABLET` → `NO_AUTORIZADO`; como `U_PANEL` sin PIN → `cancelada`
  - E2 `finalizar` una fabricación que E1 ya finalizó → `TRANSICION_INVALIDA` con `detail` que contiene `'Laura Paz'`
  - envasado `iniciar` con fabricación en `fabricando` → `TANQUE_NO_LISTO`
  - E1 inicia envasado A y luego envasado B → `OPERARIA_OCUPADA`
  - fabricación 10 L + envasado de 3×`5L` finalizado → `fabricacion_cerrada = true`, fabricación `finalizada` (sobre-envasado)
  - `U_OTRO` → `NO_AUTORIZADO`
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Escribir la migración** (`_verificar_pin`, `set_pin`, `accion`).
- [ ] **Step 4: Confirmar con el usuario y aplicar** — `apply_migration('produccion_rpc', …)`.
- [ ] **Step 5: Correr test** → `ok 1..12`.
- [ ] **Step 6: Commit** — `git commit -m "feat(db): RPC accion y set_pin con validación de PIN y transiciones"`

---

### Task 6: Migración 004 — vistas `v_tanque_estado` y `v_tiempos_efectivos`

**Files:**
- Create: `supabase/migrations/20261020000004_produccion_vistas.sql`, `supabase/tests/vistas.test.sql`

**Interfaces:**
- Produces (ambas `security_invoker = true`, respetan RLS):
  - `produccion.v_tanque_estado`: `tanque_id, codigo, capacidad_l, orden, estado text, fabricacion_id uuid null, producto_id uuid null, producto text null, color text null, litros numeric null, litros_restantes numeric null, envasado_id uuid null, operaria_id uuid null, inicio timestamptz null`. `estado ∈ ('libre','cola','fabricando','pausada','para_envasar','cola_env','envasando','env_pausado')` — derivado como `getTankState` de la app actual (fabricación abierta; si `para_envasar`, mirar envasados `activo` → `envasando`, `cola` → `cola_env`, `pausado` → `env_pausado`). `litros_restantes = greatest(0, …)`.
  - `produccion.v_tiempos_efectivos`: `entidad, entidad_id, inicio, fin, min_brutos numeric, min_pausa numeric, min_efectivos numeric` — pausas = pares `pausar→reanudar` en `eventos` (pausa abierta cuenta hasta `now()`/`fin`).

- [ ] **Step 1: Escribir `vistas.test.sql`** — `plan(5)`, como `U_PANEL`:
  - tanque sin fabricaciones → `estado = 'libre'`
  - fabricación `para_envasar` + envasado `activo` → `estado = 'envasando'`
  - sobre-envasado → `litros_restantes = 0` (no negativo)
  - eventos iniciar 10:00, pausar 10:20, reanudar 10:30, finalizar 11:00 → `min_brutos = 60`, `min_pausa = 10`, `min_efectivos = 50`
  - como `U_OTRO` → `count(*) = 0`
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Escribir la migración.** Agregar `produccion.fabricaciones`, `envasados`, `fraccionados` a la publicación `supabase_realtime`.
- [ ] **Step 4: Confirmar con el usuario y aplicar** — `apply_migration('produccion_vistas', …)`.
- [ ] **Step 5: Correr test** → `ok 1..5`.
- [ ] **Step 6: Commit** — `git commit -m "feat(db): vistas de estado de tanque y tiempos efectivos + realtime"`

---

### Task 7: Cliente Supabase, tipos y mensajes de error

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/database.types.ts`, `src/lib/errores.ts`, `src/lib/errores.test.ts`, `.env` (local, no versionado)

**Interfaces:**
- Consumes: esquema de Tasks 3-6.
- Produces:
  - `supabase: SupabaseClient<Database>` (auth `persistSession`, `storageKey: 'prodcontrol_auth'`), `db = supabase.schema('produccion')`.
  - `fetchAll<T>(build: (from: number, to: number) => PromiseLike<{data: T[] | null; error: unknown}>, pageSize = 1000): Promise<T[]>`
  - `type CodigoError = 'NO_AUTORIZADO' | 'PIN_INCORRECTO' | 'PIN_BLOQUEADO' | 'OPERARIA_INACTIVA' | 'TRANSICION_INVALIDA' | 'OPERARIA_OCUPADA' | 'TANQUE_NO_LISTO' | 'NO_ENCONTRADO' | 'RED' | 'DESCONOCIDO'`
  - `mensajeError(err: unknown): { codigo: CodigoError; texto: string }`

- [ ] **Step 1: Generar tipos** — MCP `generate_typescript_types` (incluyendo esquema `produccion`) → `src/lib/database.types.ts`. Llenar `.env` con URL y anon key de plataforma (`get_project_url`, `get_publishable_keys`).
- [ ] **Step 2: Tests `errores.test.ts`:**
  - `{message:'PIN_INCORRECTO'}` → `{codigo:'PIN_INCORRECTO', texto:'PIN incorrecto. Probá de nuevo.'}`
  - `{message:'PIN_BLOQUEADO'}` → texto `'Demasiados intentos. Esperá un minuto.'`
  - `{message:'TRANSICION_INVALIDA', details:'ya la finalizó Laura Paz a las 14:02'}` → texto `'Esta tarea ya la finalizó Laura Paz a las 14:02.'`
  - `{message:'OPERARIA_OCUPADA', details:'Lavandina 5L'}` → `'Ya estás envasando Lavandina 5L.'`
  - `new TypeError('Failed to fetch')` → `codigo:'RED'`, `'Sin conexión. Revisá el WiFi.'`
  - cualquier otro → `codigo:'DESCONOCIDO'`, `'Algo salió mal. Avisá a la encargada.'`
  - `fetchAll` con un builder falso que devuelve 1000, 1000, 3 filas → 2003 filas y 3 llamadas.
- [ ] **Step 3: Ver fallar** — `npm test -- --run src/lib` → FAIL (módulos inexistentes).
- [ ] **Step 4: Implementar** `supabase.ts` y `errores.ts`. Textos restantes: `NO_AUTORIZADO` → `'No tenés permiso para esta acción.'`, `OPERARIA_INACTIVA` → `'Tu usuario está inactivo. Avisá a la encargada.'`, `TANQUE_NO_LISTO` → `'El tanque todavía no está listo para envasar.'`, `NO_ENCONTRADO` → `'La tarea ya no existe.'`
- [ ] **Step 5: Ver pasar** — `npm test -- --run src/lib` → PASS; `npm run typecheck` → sin errores.
- [ ] **Step 6: Commit** — `git commit -m "feat: cliente supabase, fetchAll y mensajes de error"`

---

### Task 8: Dominio puro — tanque y acciones

**Files:**
- Create: `src/domain/tanque.ts`, `src/domain/tanque.test.ts`, `src/domain/acciones.ts`, `src/domain/acciones.test.ts`

**Interfaces:**
- Produces:
  - `type EstadoTanque = 'libre'|'cola'|'fabricando'|'pausada'|'para_envasar'|'cola_env'|'envasando'|'env_pausado'`
  - `nivelTanque(t: { estado: EstadoTanque; capacidad: number; litros?: number | null; litrosRestantes?: number | null; progresoFab?: number }): number` — fracción 0..1. `fabricando|pausada` → `litros × progresoFab / capacidad` (progresoFab 0..1, default 0.5); `para_envasar|cola_env|envasando|env_pausado` → `litrosRestantes / capacidad`; `libre|cola` → 0. Siempre clamp 0..1.
  - `burbujasTanque(estado: EstadoTanque): number` — `fabricando` 6, `envasando` 2, resto 0.
  - `olaPausada(estado: EstadoTanque): boolean` — `pausada|env_pausado`.
  - `type Entidad = 'fabricacion'|'envasado'|'fraccionado'`; `type Accion = 'iniciar'|'pausar'|'reanudar'|'finalizar'|'cancelar'`
  - `accionesPosibles(entidad: Entidad, estado: string, rol: 'panel'|'planta'): Accion[]` — espejo de las transiciones de Task 5 (planta nunca incluye `cancelar`).

- [ ] **Step 1: Tests:**
  - `nivelTanque({estado:'libre',capacidad:2000})` → `0`
  - `nivelTanque({estado:'fabricando',capacidad:2000,litros:1000,progresoFab:1})` → `0.5`
  - `nivelTanque({estado:'envasando',capacidad:2000,litrosRestantes:3000})` → `1` (clamp)
  - `nivelTanque({estado:'envasando',capacidad:2000,litrosRestantes:-5})` → `0`
  - `burbujasTanque('fabricando')` → `6`; `('envasando')` → `2`; `('pausada')` → `0`
  - `olaPausada('env_pausado')` → `true`
  - `accionesPosibles('fabricacion','fabricando','planta')` → `['pausar','finalizar']`
  - `accionesPosibles('fabricacion','cola','panel')` → `['iniciar','cancelar']`
  - `accionesPosibles('envasado','pausado','planta')` → `['reanudar']`
  - `accionesPosibles('fraccionado','finalizado','panel')` → `[]`
- [ ] **Step 2: Ver fallar** — `npm test -- --run src/domain`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(domain): nivel de tanque y acciones posibles"`

---

### Task 9: Sistema visual — tokens, `<Tanque>`, `<Chip>`

**Files:**
- Create: `src/ui/tokens.css`, `src/ui/Tanque.tsx`, `src/ui/Tanque.css`, `src/ui/Chip.tsx`, `src/ui/Tanque.test.tsx`
- Modify: `index.html` (Google Fonts: Fraunces ital/opsz 300-700, Geist 300-700, Geist Mono 400-500), `src/main.tsx` (importa `tokens.css`)

**Interfaces:**
- Consumes: `nivelTanque`, `burbujasTanque`, `olaPausada` (Task 8).
- Produces:
  - `<Tanque estado: EstadoTanque, color?: string, nivel: number, ancho?: number = 60, etiqueta?: string />` — viewBox `0 0 60 120`, vidrio `rect x=3 y=3 w=54 h=114 rx=14`; dos `path` de ola (clase `ola`, `ola b`) en un grupo `.liquido` con `transform: translateY(6 + (1−nivel)·108)` y transición 1.6 s `cubic-bezier(.22,1,.36,1)`; `burbujasTanque(estado)` círculos `.burbuja`; contorno punteado y color `#cbd5e1` si `libre|cola`; `data-estado` y `role="img"` con `aria-label` = `etiqueta ?? "Tanque <estado>"`; `clipPath` id único con `useId()`.
  - `<Chip estado: string />` — clases y textos: fabricando "Fabricando" (verde `#dcfce7/#166534`), envasando/activo "Envasando" (`#e0f2fe/#075985`), fraccionado "Fraccionado" (`#fef3c7/#92400e`), pausada/pausado/env_pausado "Pausado" (`#fee2e2/#991b1b`), cola/cola_env "En cola" (`#f1f5f9/#475569`), finalizada/finalizado "Terminada" (`#ede9fe/#5b21b6`), libre "Libre" (punteado). Punto pulsante en estados en curso.
  - `tokens.css`: variables de Global Constraints + `--serif/--sans/--mono`, `--ease: cubic-bezier(.22,1,.36,1)`; keyframes `ola`, `burbuja`, `pulso`; bloque `@media (prefers-reduced-motion: reduce)` que anula animaciones y transiciones de `.ola, .burbuja, .liquido, .chip i`.

- [ ] **Step 1: Tests `Tanque.test.tsx`:**
  - `estado='fabricando'` → 6 elementos `.burbuja`
  - `estado='libre'` → 0 `.burbuja` y el contorno tiene `stroke-dasharray`
  - `nivel=0.5` → `.liquido` con `transform` que contiene `translateY(60px)`
  - `estado='pausada'` → las `.ola` tienen `animation-play-state: paused` (style inline)
  - `color='#db2777'` → las `.ola` tienen `fill="#db2777"`
  - dos `<Tanque>` en la misma página → ids de `clipPath` distintos
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** (referencia visual: `tankSVG()` en `.superpowers/brainstorm/115-1792523762/content/pc-prototipo.html`).
- [ ] **Step 4: Ver pasar** — `npm test -- --run src/ui`.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): tokens, Tanque animado y Chip de estado"`

---

### Task 10: Sesión, rutas protegidas y pared de tanques en vivo

**Files:**
- Create: `src/auth/useSesion.ts`, `src/auth/RequireRol.tsx`, `src/auth/RequireRol.test.tsx`, `src/auth/Login.tsx`, `src/lib/useRealtime.ts`, `src/pages/PanelInicio.tsx`, `src/pages/PlantaInicio.tsx`, `src/pages/ParedTanques.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `supabase`, `db`, `fetchAll`, `mensajeError` (Task 7); `<Tanque>`, `<Chip>`, `nivelTanque` (Tasks 8-9).
- Produces:
  - `useSesion(): { cargando: boolean; usuario: User | null; rol: 'panel' | 'planta' | null }` — rol desde `public.profiles` con las reglas de Global Constraints (panel tiene prioridad).
  - `<RequireRol rol: 'panel'|'planta'>{children}</RequireRol>` — cargando → spinner; sin usuario → `<Navigate to="/login?next=<ruta>">`; rol distinto → pantalla "Sin acceso" con botón Salir.
  - `useRealtime<T>(tabla: string, cargar: () => Promise<T[]>, canales: string[]): { datos: T[]; conectado: boolean; error: string | null }` — carga inicial, suscribe a `postgres_changes` del esquema `produccion` para cada tabla de `canales` y recarga ante cambio (debounce 300 ms); si el canal no está `SUBSCRIBED`, polling cada 15 s; `conectado` refleja `navigator.onLine` y el estado del canal.
  - Rutas (`BrowserRouter basename="/Produccion"`): `/login`, `/panel` (RequireRol panel → `PanelInicio`), `/planta` (RequireRol planta → `PlantaInicio`), `/` → redirige según rol.
  - `<ParedTanques />` — lee `v_tanque_estado` ordenado por `orden` con `useRealtime(..., ['fabricaciones','envasados'])`; grilla de `<Tanque>` + código + producto + `<Chip>`. `PanelInicio` y `PlantaInicio` la muestran con un encabezado ("Panel" / "Planta") y botón Salir; banda "Sin conexión" si `!conectado`.
  - `Login`: email + contraseña (`signInWithPassword`), errores con `mensajeError`, redirige a `next`.

- [ ] **Step 1: Tests `RequireRol.test.tsx`** (mock de `useSesion`):
  - sin usuario → renderiza la ruta `/login?next=%2Fpanel`
  - usuario `planta` en ruta `panel` → texto "Sin acceso"
  - usuario `panel` en ruta `panel` → renderiza children
  - `cargando` → `role="status"`
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** los archivos listados.
- [ ] **Step 4: Ver pasar** — `npm test -- --run`.
- [ ] **Step 5: Verificación real** — pedir al usuario (o crear con su OK) un usuario panel y uno `tablet-planta-1` en plataforma con los módulos correspondientes; cargar con su OK un tanque y producto de prueba. `npm run dev`; en el navegador: login panel → `/panel` muestra la pared; desde `execute_sql` cambiar una fabricación a `fabricando` → el tanque se llena con burbujas sin recargar; cortar red (DevTools offline) → aparece "Sin conexión". Probar a 1440×900 y 1180×820. Borrar los datos de prueba al terminar (con OK).
- [ ] **Step 6: Commit** — `git commit -m "feat: sesión, rutas protegidas y pared de tanques en vivo"`

---

### Task 11: Publicación en GitHub Pages

**Files:**
- Create: `public/404.html`, `.github/workflows/deploy.yml`
- Modify: `index.html` (script de restauración de ruta)

**Interfaces:**
- Produces: workflow que en push a `main` corre `npm ci`, `npm test -- --run`, `npm run build` (con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` desde *repository variables*) y publica `dist/` con `actions/deploy-pages`. `404.html` guarda `location.pathname+search` en `sessionStorage` y redirige a `/Produccion/`; `index.html` lo restaura con `history.replaceState` antes de montar React.

- [ ] **Step 1: Escribir `404.html`, el script en `index.html` y el workflow.**
- [ ] **Step 2: Verificar build** — `npm run build` → `dist/404.html` existe; `npx vite preview --base /Produccion/` y abrir `/Produccion/planta?tanque=T-01` directo → llega a login con `next` preservando `?tanque=T-01`.
- [ ] **Step 3: Commit** — `git commit -m "ci: publicación en GitHub Pages"`
- [ ] **Step 4: Publicar (requiere OK del usuario)** — preguntar si crear el repo `Produccion` en su cuenta/org de GitHub con `gh repo create`, configurar las variables y habilitar Pages; recién con el OK, push a `main` y verificar que la URL publicada carga el login.
