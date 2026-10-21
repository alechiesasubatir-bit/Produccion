# ProdControl · Plan 3 — Panel `/panel` operativo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la encargada, desde la PC, vea el flujo de producción en vivo (kanban), cree órdenes, opere los tanques (acciones de encargada y QR) y configure catálogos, operarias (con PIN) y usuarios.

**Architecture:** La base agrega eventos `crear`/`editar` por trigger, la vista `v_flujo` (tareas abiertas + terminadas hoy) y dos RPC para administrar el rol de producción de los usuarios. El front reemplaza el placeholder `PanelInicio` por un shell con navegación (Flujo · Tanques · Configuración), lógica pura en `src/domain/` y vistas en `src/panel/`. Las escrituras de catálogos y órdenes van por tablas (RLS + grants por columna); las de estado, por `accion()`.

**Tech Stack:** igual que planes 1-2 + `qrcode` (generación de QR en SVG).

**Spec:** `docs/superpowers/specs/2026-10-20-prodcontrol-rediseno-design.md` (§4.5 RLS, §5.1 PC, §6, §7, §9). Esquema real: `docs/notas/plataforma-esquema.md`. Referencia visual: `.superpowers/brainstorm/115-1792523762/content/pc-prototipo.html` (layout B · kanban, `renderKPIsB`, `cardHTML`).

**Base existente:** `accion()` (no lanza, `{ok:false,codigo,detalle}`; el panel acciona sin PIN y puede finalizar `para_envasar`), `set_pin`, `v_tanque_estado`, `v_tareas`, `v_operarias`, `v_tiempos_efectivos`; grants: el panel inserta/edita solo columnas de datos (no `estado/inicio/fin`) en fabricaciones/envasados/fraccionados y catálogos completos; `operarias` insert `(empleado_id, categoria, color_avatar, activo)`, update `(categoria, color_avatar, activo)`. Front: `useRealtime` (`{datos, conectado, enVivo, error, recargar}`), `fetchAll`, `db`, `mensajeError`, `ejecutarAccion`, `<Tanque>`, `<Chip>`, `nivelTanque`, `accionesPosibles`, `tituloTarea`, `formatoCronometro`, `segundosTranscurridos`, `ParedTanques`, `Encabezado`. Tests SQL: pgTAP vía `execute_sql` (begin + `_fixtures.sql` + test, salida en `_tap`).

## Global Constraints

- Proyecto **Plataforma** `iyqufnmpjkyfzspujwyf`. **OK del usuario antes de cada `apply_migration`**; ensayar en `begin … rollback` antes. Actualizar `src/lib/database.types.ts` a mano con cada cambio de esquema.
- Publicar = merge `--ff-only` a `main`, push con la cuenta `alechiesasubatir-bit` y **disparar a mano** `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main` (el push no lo dispara); volver `gh` a `achiesa77-ctrl`.
- Columnas del kanban, en orden: **Cola → Fabricando → Para envasar → Envasando → Fraccionado → Terminadas hoy** (spec §5.1). "Hoy" = día calendario en `America/Montevideo`.
- KPIs compactos de la barra del Flujo: **cola · fabricando · envasando · litros hoy** (contadores animados; instantáneos con reduced motion).
- Navegación superior del panel: **Flujo · Tanques · Configuración** (Historial, KPIs y Alertas son del plan 4). Rutas: `/panel`, `/panel/tanques`, `/panel/config`.
- QR del tanque apunta a `https://alechiesasubatir-bit.github.io/Produccion/planta?tanque=<codigo>` (se arma con `location.origin` + `import.meta.env.BASE_URL`).
- Validación de PIN: 4 dígitos. Colores: hex `#rrggbb`.
- Sin conexión: banda "Sin conexión" y botones de escritura deshabilitados (como la tablet).
- `prefers-reduced-motion: reduce` → sin vuelos FLIP ni tweens.
- Verificación visual a **1440×900**.

## Review Focus

1. **Dos órdenes de fabricación para el mismo tanque** (dos encargadas o doble clic) → la segunda falla con mensaje humano "Ese tanque ya tiene una orden abierta.", no un error crudo 23505. (Test en Task 5.)
2. **Envasar más de lo que queda en el tanque** al crear la orden → advertencia visible con los litros restantes, pero se permite (la merma/sobrante es real). (Test en Task 2 y Task 5.)
3. **Una tarea cambia de columna por Realtime mientras la encargada mira** → la tarjeta vuela a su nueva columna (FLIP con `layoutId`), sin duplicarse ni parpadear. (Test en Task 4: misma tarjeta aparece una sola vez tras el cambio.)
4. **La encargada se quita a sí misma el rol de panel** desde Usuarios → la RPC lo impide ("No podés cambiar tu propio rol."). (Test en Task 1.)
5. **Alta de una operaria que ya existe** (mismo funcionario) → el funcionario no aparece en la lista de candidatos; si igual llega, mensaje "Esa persona ya es operaria." (Test en Task 8.)

---

## File Structure

```
supabase/migrations/20261022000007_produccion_panel.sql   # triggers crear/editar, v_flujo, RPC usuarios, realtime catálogos
supabase/tests/panel.test.sql
src/lib/database.types.ts             # + v_flujo, listar_usuarios, set_rol_usuario
src/lib/acciones.ts                   # + accionPanel()
src/lib/errores.ts                    # + mensajes de constraint (23505 tanque, operaria duplicada)
src/domain/flujo.ts                   # columnas del kanban, contadores
src/domain/ordenes.ts                 # validación de nuevas órdenes
src/panel/PanelApp.tsx  panel.css     # shell + navegación
src/panel/Flujo.tsx  TarjetaFlujo.tsx  KpisFlujo.tsx
src/panel/NuevaOrden.tsx
src/panel/Tanques.tsx  DetalleTanque.tsx  QrTanque.tsx
src/panel/config/Configuracion.tsx  EditorCatalogo.tsx  Operarias.tsx  Usuarios.tsx
e2e/panel.spec.ts  e2e/mocks.ts (extender)
```

---

### Task 1: Migración 007 — eventos de alta/edición, `v_flujo`, usuarios

**Files:**
- Create: `supabase/migrations/20261022000007_produccion_panel.sql`, `supabase/tests/panel.test.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Produces:
  - Trigger `after insert or update` en `fabricaciones`, `envasados`, `fraccionados` → función `produccion._registrar_evento()` (`security definer`, `search_path=''`, entidad por `TG_ARGV[0]`): insert → evento `crear` (`usuario_id = auth.uid()`); update con `old.estado = new.estado` → evento `editar` con `datos = {campo: nuevo valor}` solo de las columnas que cambiaron (los cambios de estado ya los registra `accion()`).
  - Vista `produccion.v_flujo` (`security_invoker`): mismas columnas que `v_tareas` + `fin timestamptz null`, `fabricacion_id uuid null` (de envasados), `litros_restantes numeric null` (de la fabricación, `greatest(0, …)` como en `v_tanque_estado`). Incluye: fabricaciones `cola|fabricando|pausada|para_envasar`, envasados y fraccionados `cola|activo|pausado`, y las tres entidades en `finalizada|finalizado` con `fin` del día de hoy en `America/Montevideo`. `listo` igual que en `v_tareas`.
  - `produccion.listar_usuarios() returns table(id uuid, email text, nombre text, rol text, rol_produccion text, activo boolean)` — `security definer`; si no `es_panel()` → `raise exception using errcode='42501', message='NO_AUTORIZADO'`. Orden por email.
  - `produccion.set_rol_usuario(p_usuario uuid, p_rol text) returns void` — solo `es_panel()` (42501 `NO_AUTORIZADO`); `p_rol in ('panel','planta')` o null, si no 22023 `ROL_INVALIDO`; `p_usuario = auth.uid()` → 42501 `NO_PROPIO_ROL` (detail "No podés cambiar tu propio rol."); actualiza solo `public.perfiles.rol_produccion`.
  - Grants de ejecución a authenticated; revoke de public/anon.
  - Publicación `supabase_realtime`: agregar `produccion.tanques`, `produccion.productos`, `produccion.operarias`.
- [ ] **Step 1: Escribir `panel.test.sql`** — `plan(7)`:
  - como `U_PANEL`: insert de fabricación en `T-TEST` → 1 evento `crear` con `usuario_id = U_PANEL`
  - como `U_PANEL`: `update … set lote='L-2'` → evento `editar` con `datos->>'lote' = 'L-2'`; un `accion(…,'iniciar')` posterior **no** agrega `editar`
  - `v_flujo`: envasado `finalizado` con `fin = now()` aparece; otro con `fin = now() - interval '2 days'` no
  - como `U_TABLET`: `throws_ok('select * from produccion.listar_usuarios()', '42501')`
  - como `U_PANEL`: `set_rol_usuario(U_OTRO, 'planta')` → `perfiles.rol_produccion = 'planta'` (verificado como postgres)
  - como `U_PANEL`: `throws_ok(set_rol_usuario(U_PANEL, null), '42501', 'NO_PROPIO_ROL')`
  - como `U_PANEL`: `throws_ok(set_rol_usuario(U_OTRO, 'jefe'), '22023')`
- [ ] **Step 2: Correr y ver fallar.** **Step 3: Escribir la migración.** **Step 4: Ensayar** (`ok 1..7`). **Step 5: OK del usuario y aplicar**; `get_advisors(security)` sin hallazgos nuevos no intencionales. **Step 6: Re-correr contra lo aplicado** (`ok 1..7`) + `tablet.test.sql` (`ok 1..7`).
- [ ] **Step 7: Tipos** (`v_flujo`, `listar_usuarios` → `Returns: {id,email,nombre,rol,rol_produccion,activo}[]`, `set_rol_usuario`); typecheck.
- [ ] **Step 8: Commit** — `feat(db): eventos de alta/edición, v_flujo y administración de roles`

---

### Task 2: Dominio del panel — flujo y órdenes

**Files:**
- Create: `src/domain/flujo.ts`, `src/domain/flujo.test.ts`, `src/domain/ordenes.ts`, `src/domain/ordenes.test.ts`

**Interfaces:**
- Produces:
  - `type FilaFlujo = Database['produccion']['Views']['v_flujo']['Row']`
  - `type Columna = 'cola' | 'fabricando' | 'para_envasar' | 'envasando' | 'fraccionado' | 'terminadas'`; `COLUMNAS: { id: Columna; titulo: string }[]` con títulos "Cola", "Fabricando", "Para envasar", "Envasando", "Fraccionado", "Terminadas hoy".
  - `columnaFlujo(f: FilaFlujo): Columna` — terminadas: `finalizada|finalizado`; fraccionado abierto → `fraccionado`; fabricación `cola` → `cola`, `fabricando|pausada` → `fabricando`, `para_envasar` → `para_envasar`; envasado `cola` → `para_envasar`, `activo|pausado` → `envasando`.
  - `agruparFlujo(filas: FilaFlujo[]): Record<Columna, FilaFlujo[]>` — dentro de cada columna: corriendo primero, luego `created_at`; terminadas por `fin` descendente.
  - `kpisFlujo(filas: FilaFlujo[]): { cola: number; fabricando: number; envasando: number; litrosHoy: number }` — `litrosHoy` = Σ `litros` de las fabricaciones `finalizada` hoy (litros fabricados en el día).
  - `type NuevaFabricacion = { tanque_id: string; producto_id: string; litros: number; lote: string; operaria_id: string | null }` (y `NuevoEnvasado`, `NuevoFraccionado` con las columnas insertables del plan 1/migración 005).
  - `validarFabricacion(d, ctx: { capacidad: number | null; tanqueLibre: boolean }): Partial<Record<keyof NuevaFabricacion, string>>` — tanque requerido y libre ("Ese tanque no está libre."), producto requerido, `0 < litros ≤ capacidad` ("Máximo <capacidad> L.").
  - `validarEnvasado(d, ctx: { litrosRestantes: number | null; litrosEquiv: number | null }): { errores: …; advertencia: string | null }` — fabricación, presentación requeridas, `cantidad` entero > 0; `advertencia` si `cantidad × litrosEquiv > litrosRestantes`: `"Quedan <r> L en el tanque y esta orden usa <u> L."`.
  - `validarFraccionado(d)` — tipo requerido, `cantidad` entero > 0.
- [ ] **Step 1: Tests:**
  - `columnaFlujo` para: envasado `cola` → `para_envasar`; fabricación `pausada` → `fabricando`; fraccionado `activo` → `fraccionado`; envasado `finalizado` → `terminadas`
  - `agruparFlujo`: en `terminadas` la de `fin` más reciente va primero
  - `kpisFlujo`: 2 fabricaciones finalizadas hoy de 1000 y 500 L → `litrosHoy = 1500`; una fabricando + una pausada → `fabricando = 2`
  - `validarFabricacion({litros: 2500…}, {capacidad: 2000, tanqueLibre: true}).litros` → `'Máximo 2000 L.'`; tanque no libre → `tanque_id: 'Ese tanque no está libre.'`
  - `validarEnvasado({cantidad: 100…}, {litrosRestantes: 300, litrosEquiv: 5}).advertencia` → `'Quedan 300 L en el tanque y esta orden usa 500 L.'`; `cantidad: 2.5` → error `'Tiene que ser un número entero mayor a 0.'`
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `feat(domain): columnas del flujo, KPIs y validación de órdenes`

---

### Task 3: Shell del panel y acciones de encargada

**Files:**
- Create: `src/panel/PanelApp.tsx`, `src/panel/panel.css`, `src/panel/PanelApp.test.tsx`
- Modify: `src/App.tsx` (rutas `/panel/*` → `PanelApp`), `src/lib/acciones.ts` + test (`accionPanel`), `src/lib/errores.ts` + test; delete `src/pages/PanelInicio.tsx`

**Interfaces:**
- Consumes: `Encabezado` (plan 1), `RequireRol`.
- Produces:
  - `<PanelApp />` — encabezado con marca, pestañas `NavLink` "Flujo" (`/panel`, `end`), "Tanques", "Configuración", usuario y Salir; `<Routes>` internas; banda "Sin conexión" si `!navigator.onLine` (hook `useEnLinea(): boolean` exportado de `src/lib/useEnLinea.ts`, reutilizable).
  - `accionPanel(p: { entidad: Entidad; id: string; accion: Accion }): Promise<Resultado<{ fabricacionCerrada: boolean }>>` — llama `accion` sin `p_empleado_id`/`p_pin`.
  - `mensajeError` reconoce errores de constraint de PostgREST: `code '23505'` con `fabricaciones_tanque_abierta_uk` en `message` → codigo `TANQUE_OCUPADO`, texto `'Ese tanque ya tiene una orden abierta.'`; `23505` con `operarias_pkey` → `OPERARIA_DUPLICADA`, `'Esa persona ya es operaria.'`; `42501` con message `NO_PROPIO_ROL` → `'No podés cambiar tu propio rol.'`; `PIN_INVALIDO` → `'El PIN son 4 dígitos.'`. Agregar esos códigos a `CodigoError`.
- [ ] **Step 1: Tests** — `errores.test.ts`: los cuatro casos nuevos; `acciones.test.ts`: `accionPanel` llama `rpc('accion', {p_entidad, p_id, p_accion})` sin PIN; `PanelApp.test.tsx` (mock de las vistas hijas): en `/panel/tanques` la pestaña "Tanques" tiene `aria-current="page"`; con `navigator.onLine=false` + evento `offline` se ve "Sin conexión".
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar** + suite completa.
- [ ] **Step 5: Commit** — `feat(panel): shell con navegación, acciones de encargada y errores de constraint`

---

### Task 4: Flujo (kanban en vivo)

**Files:**
- Create: `src/panel/Flujo.tsx`, `src/panel/TarjetaFlujo.tsx`, `src/panel/KpisFlujo.tsx`, `src/panel/flujo.test.tsx`

**Interfaces:**
- Consumes: `useRealtime('v_flujo', …, ['fabricaciones','envasados','fraccionados'])`, `v_operarias` para nombres (map `empleado_id → nombre`), `agruparFlujo`, `kpisFlujo`, `COLUMNAS`, `accionPanel`, `accionesPosibles(…,'panel')`.
- Produces:
  - `<Flujo />` — barra con `<KpisFlujo>` + botón "+ Nueva orden" (abre `<NuevaOrden>` de Task 5; hasta entonces un stub que se reemplaza); 6 columnas con contador; `LayoutGroup` de motion y cada tarjeta `motion.article` con `layoutId={fila.id}` (sin `layout` en reduced motion).
  - `<TarjetaFlujo fila onAccion />` — mini `<Tanque>` (si `tanque_codigo`), `tituloTarea`, tanque, lote, nombre(s) de operaria, `<Chip>`, cronómetro si corriendo; menú de acciones de encargada (`accionesPosibles(entidad, estado, 'panel')`) con confirmación inline (sin `confirm()` nativo): para `cancelar` y `finalizar` el botón pasa a "¿Seguro?" y recién el segundo clic acciona.
  - `<KpisFlujo kpis />` — 4 números en Fraunces; tween con `animate()` de motion (0 ms en reduced motion); etiquetas "en cola", "fabricando", "envasando", "litros hoy".
  - Errores de `accionPanel` → aviso `role="alert"` arriba del tablero y `recargar()`.
- [ ] **Step 1: Tests `flujo.test.tsx`** (mock de `useRealtime` con datos controlados por el test):
  - 6 encabezados de columna en el orden de Global Constraints
  - una fila que cambia de `cola` a `fabricando` (rerender con datos nuevos) aparece una sola vez y dentro de la columna "Fabricando"
  - KPIs: con 2 en cola muestra "2" junto a "en cola" (reduced motion mockeado → valor final inmediato)
  - "Cancelar" pide "¿Seguro?" y recién al segundo clic llama `accionPanel({accion:'cancelar', …})`
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `feat(panel): flujo kanban en vivo con KPIs`

---

### Task 5: Nueva orden

**Files:**
- Create: `src/panel/NuevaOrden.tsx`, `src/panel/nuevaOrden.test.tsx`
- Modify: `src/panel/Flujo.tsx` (abrir el diálogo)

**Interfaces:**
- Consumes: `validarFabricacion/Envasado/Fraccionado`, `v_tanque_estado` (tanques libres y fabricaciones con litros restantes), catálogos activos (`productos`, `presentaciones`), `v_operarias`, `mensajeError`.
- Produces: `<NuevaOrden abierta: boolean; tipoInicial?: 'fabricacion'|'envasado'|'fraccionado'; tanqueInicial?: string; onCerrar(): void; onCreada(): void />` — `<dialog>` modal con segmentos Fabricación/Envasado/Fraccionado:
  - Fabricación: tanque (solo `estado = 'libre'`), producto (con swatch de color), litros (placeholder = capacidad), lote, operaria preasignada (opcional).
  - Envasado: fabricación (tanques en `para_envasar|cola_env|envasando|env_pausado`, rótulo "T-03 · Lavandina · quedan 820 L"), presentación, cantidad, etiquetado, operaria 1 y 2 (opcionales, distintas).
  - Fraccionado: tipo, descripción, producto y presentación opcionales, cantidad, lote, etiquetado, operaria.
  - Errores por campo debajo de cada input; advertencia de envasado en `role="status"` sin bloquear; "Crear orden" deshabilitado sin conexión o con errores; insert vía `db.from(<tabla>).insert(<columnas>)`; error de la API → `mensajeError(err).texto` en `role="alert"`; éxito → `onCreada()` + cierra.
- [ ] **Step 1: Tests** (mock de `db.from().insert()` y de las cargas):
  - fabricación con 2500 L en tanque de 2000 → "Máximo 2000 L." y botón deshabilitado
  - el selector de tanque de fabricación no ofrece tanques ocupados
  - envasado de 100 × 5L con 300 L restantes → advertencia visible y botón habilitado
  - insert que devuelve `{error:{code:'23505', message:'… fabricaciones_tanque_abierta_uk …'}}` → alerta "Ese tanque ya tiene una orden abierta."
  - éxito → `insert` llamado con `{tanque_id, producto_id, litros: 1200, lote: 'L-1', operaria_id: null}` y `onCreada`
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `feat(panel): nueva orden de fabricación, envasado y fraccionado`

---

### Task 6: Tanques — pared, panel lateral y QR

**Files:**
- Create: `src/panel/Tanques.tsx`, `src/panel/DetalleTanque.tsx`, `src/panel/QrTanque.tsx`, `src/panel/tanques.test.tsx`
- Modify: `src/pages/ParedTanques.tsx` (prop opcional `onElegir(t)`; celdas como `button`), `package.json` (`qrcode`, `@types/qrcode`)

**Interfaces:**
- Produces:
  - `<Tanques />` — `ParedTanques` con `onElegir`; panel lateral (`aside`, 420 px) con `<DetalleTanque>` del tanque elegido; cierra con Esc o "×".
  - `<DetalleTanque tanque: EstadoTanqueFila />` — `<Tanque ancho={140}>`, código, capacidad, producto, litros / litros restantes, operaria, inicio; **Recorrido**: eventos de la fabricación abierta y sus envasados (`db.from('eventos')…in('entidad_id', ids).order('at')`) como lista "HH:MM · <acción en pasado> · <quién>"; **Acciones**: `accionesPosibles` panel sobre la fabricación (y el envasado activo si hay) vía `accionPanel`; tanque libre → botón "Nueva orden en este tanque" (abre `NuevaOrden` con `tanqueInicial`); `<QrTanque>`.
  - `<QrTanque codigo />` — SVG de `QRCode.toString(url, {type:'svg', margin:1})`, la URL en texto mono debajo y botón "Imprimir" (`window.print()` con CSS `@media print` que imprime solo el QR y el código).
  - `urlPlanta(codigo: string): string` en `src/panel/QrTanque.tsx`: `${location.origin}${import.meta.env.BASE_URL}planta?tanque=${encodeURIComponent(codigo)}`.
- [ ] **Step 1: Tests:** clic en la celda de `T-01` abre el aside con "T-01"; el QR contiene un `<svg>` y el texto `…/planta?tanque=T-01`; tanque libre muestra "Nueva orden en este tanque"; el recorrido lista "10:15 · inició · Laura Paz" (eventos mockeados, hora en Montevideo).
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `feat(panel): vista de tanques con panel lateral, recorrido y QR`

---

### Task 7: Configuración — catálogos

**Files:**
- Create: `src/panel/config/Configuracion.tsx`, `src/panel/config/EditorCatalogo.tsx`, `src/panel/config/catalogos.test.tsx`

**Interfaces:**
- Produces:
  - `<Configuracion />` — sub-navegación "Productos · Presentaciones · Tanques · Operarias · Usuarios" (estado local, no rutas).
  - `<EditorCatalogo<T> tabla: 'productos'|'presentaciones'|'tanques'; campos: Campo<T>[]; orden: keyof T />` con `type Campo<T> = { clave: keyof T; etiqueta: string; tipo: 'texto'|'numero'|'color'|'seleccion'|'booleano'; opciones?: string[]; requerido?: boolean; min?: number }` — tabla con todas las filas (incluye inactivas, atenuadas), fila editable inline (Guardar/Cancelar), "+ Agregar" con fila nueva arriba, sin borrado (se desactiva con `activo`); validación: requeridos, números > `min`, color `^#[0-9a-fA-F]{6}$`; errores de la API con `mensajeError` (23505 de nombre/código único → texto `'Ya existe uno con ese nombre.'`, agregar a `errores.ts`).
  - Productos: nombre, color (input color + **vista previa con `<Tanque estado="fabricando" nivel={0.6} color=…>`**), tipo (`liquido|denso|polvo`), litros/hora estándar, activo. Presentaciones: nombre, litros equivalentes (`min 0`), activo. Tanques: código, capacidad (`min 0`), orden, activo.
- [ ] **Step 1: Tests:** agregar producto con color `#12345` → error "Color inválido."; color válido → `insert({nombre, color, tipo, litros_hora_std, activo})`; la vista previa del tanque usa el color elegido (`.ola` con `fill`); 23505 → "Ya existe uno con ese nombre."; desactivar un tanque llama `update({activo:false}).eq('id', …)`.
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `feat(panel): configuración de productos, presentaciones y tanques`

---

### Task 8: Configuración — operarias y usuarios

**Files:**
- Create: `src/panel/config/Operarias.tsx`, `src/panel/config/Usuarios.tsx`, `src/panel/config/personas.test.tsx`

**Interfaces:**
- Consumes: `core.funcionarios` (vía `supabase.schema('core').from('funcionarios').select('id,nombre,foto_url,sector,estado').neq('estado','baja')`), `produccion.operarias` (select de columnas permitidas) unida a funcionarios en el cliente, `set_pin`, `listar_usuarios`, `set_rol_usuario`.
- Produces:
  - `<Operarias />` — lista de operarias (avatar, nombre, categoría, color, activo y botón "Cambiar PIN" — el front no puede saber si hay PIN porque `pin_hash` no es legible); "+ Agregar operaria": buscador sobre funcionarios no-baja que **no** son operarias, con filtro por sector (default "Producción"); al elegir: categoría, color, PIN inicial (4 dígitos, requerido) → `insert` en `operarias` y luego `rpc('set_pin')`; "Cambiar PIN" por fila; toggle activo.
  - `<Usuarios />` — `rpc('listar_usuarios')`; por fila: email, nombre, rol de plataforma (solo lectura) y selector "Sin acceso · Planta (tablet) · Panel (encargada)" → `rpc('set_rol_usuario')`; la fila del usuario actual muestra el selector deshabilitado con "(vos)". Los admin de plataforma muestran "Panel (admin)" fijo.
- [ ] **Step 1: Tests:** el buscador no ofrece a quien ya es operaria; alta con PIN "12a4" → "El PIN son 4 dígitos." sin llamar a la API; alta válida llama `insert` y después `set_pin` con `{p_empleado_id, p_pin:'1234'}`; `23505` en insert → "Esa persona ya es operaria."; Usuarios: cambiar a "Planta" llama `set_rol_usuario({p_usuario, p_rol:'planta'})`; la propia fila tiene el selector deshabilitado.
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `feat(panel): operarias con PIN y roles de usuarios`

---

### Task 9: E2E, verificación real y publicación

**Files:**
- Create: `e2e/panel.spec.ts`
- Modify: `e2e/mocks.ts` (perfil panel; `v_flujo`, `v_tanque_estado`, catálogos, inserts)

- [ ] **Step 1: `panel.spec.ts`** (API simulada, viewport 1440×900): login simulado como panel → Flujo con 6 columnas → "+ Nueva orden" → fabricación en `T-01` → la tarjeta aparece en "Cola" (el mock devuelve la fila tras el insert) → Tanques → clic `T-01` → aside con QR → Configuración → Productos lista "Lavandina". Captura `test-results/panel-1440.png`.
- [ ] **Step 2: Correr** `npx playwright test` → 2 passed (tablet + panel). Revisar la captura.
- [ ] **Step 3: Verificación real con el usuario** (`npm run dev`, el usuario entra con su cuenta admin): dar de alta una operaria real con PIN desde Configuración, crear una fabricación en T-01 (o usar `PRUEBA-001`), y en otra pestaña entrar a `/planta` con la tablet (el usuario tipea la contraseña) → la operaria aparece, toma la tarea con su PIN y el kanban del panel la mueve a "Fabricando" en vivo. Al terminar: preguntar si se conservan la operaria y la orden.
- [ ] **Step 4: Commit** — `test(e2e): flujo del panel`
- [ ] **Step 5: Publicar (OK del usuario)** según Global Constraints y verificar `/panel` publicado.
