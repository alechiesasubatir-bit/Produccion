# ProdControl · Plan 2 — Tablet `/planta` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una operaria, en la tablet de planta, elija su nombre, ponga su PIN y tome/inicie/pause/reanude/finalice sus tareas en pocos toques, con cronómetro, confirmación animada y cierre de sesión automático.

**Architecture:** La base agrega una vista `v_tareas` (las tres entidades unificadas) y la RPC `verificar_pin`; toda escritura sigue pasando por `accion()`. El front agrega lógica pura en `src/domain/tareas.ts`, una capa de datos fina en `src/lib/` y una máquina de pantallas en `src/planta/` (quién → PIN → tareas → confirmación) que reemplaza el placeholder `PlantaInicio`.

**Tech Stack:** igual que el plan 1 (Supabase vía MCP, Vite 8, React 19, TS 6, motion, Vitest + Testing Library) + Playwright para el flujo E2E.

**Spec:** `docs/superpowers/specs/2026-10-20-prodcontrol-rediseno-design.md` (§5.2 tablet, §6 visual, §7 errores, §8 pruebas). Esquema real: `docs/notas/plataforma-esquema.md`.

**Base existente (plan 1):** `produccion.accion()` devuelve `{ok:true,...fila, fabricacion_cerrada}` o `{ok:false, codigo, detalle}` (no lanza); `mensajeError(err)` acepta ese formato; `useRealtime`, `fetchAll`, `db`, `<Tanque>`, `<Chip>`, `nivelTanque`, `accionesPosibles(entidad, estado, rol)`, `RequireRol`, `SesionProvider`. Tests SQL: pgTAP vía `execute_sql` concatenando `begin;` + `_fixtures.sql` + test; salida en temp table `_tap`; fixtures usan `T-TEST`/`Lavandina-test`/`5L-test`, operarias E1 Laura Paz, E2 Rosa Díaz (PIN 1234), E3 dada de baja; usuarios U_PANEL `…a1`, U_TABLET `…a2`, U_OTRO `…a3`.

## Global Constraints

- Proyecto Supabase **Plataforma** `iyqufnmpjkyfzspujwyf`, esquema `produccion`. **Pedir OK al usuario antes de cada `apply_migration`** (es producción). Ensayar la migración dentro de `begin … rollback` antes de aplicarla.
- Al cambiar el esquema, actualizar a mano `src/lib/database.types.ts` (el generador del MCP solo emite `public`).
- La tablet nunca cancela; las órdenes se crean en la PC. La tablet solo toma/inicia/pausa/reanuda/finaliza (spec §5.2).
- Sin conexión: banda "Sin conexión" y acciones **deshabilitadas**, nada se encola (spec §7).
- Tamaños táctiles ≥ 64 px de alto en acciones primarias; teclas del PIN ≥ 72 px.
- Cierre automático a los **30 s** sin interacción, con anillo visible.
- `prefers-reduced-motion: reduce` → sin sacudida, estallido, vuelos ni entrada escalonada; cambios instantáneos.
- El PIN vive solo en memoria (estado React) mientras la operaria está activa; nunca en storage, URL ni logs.
- Textos en español rioplatense. Referencia visual: `.superpowers/brainstorm/115-1792523762/content/tablet-prototipo.html`.
- Verificación visual a **1180×820**.

## Review Focus

1. **La tablet queda sola con una operaria "logueada"** → a los 30 s vuelve a "¿Quién trabaja?" y olvida operaria y PIN; la siguiente persona no puede accionar como la anterior. (Test en Task 4 y Task 7.)
2. **Otra operaria o la encargada ya finalizó la tarea** → mensaje humano con el detalle ("Esta tarea ya la finalizó …"), la lista se refresca, **no** se muestra la confirmación. (Test en Task 7.)
3. **Se corta el WiFi con la pantalla de tareas abierta** → banda visible y botones deshabilitados; al volver la red se habilitan y la lista se recarga. Realtime caído con red OK **no** deshabilita acciones. (Tests en Task 3 y Task 6.)
4. **PIN bloqueado** → mensaje "Demasiados intentos. Esperá un minuto.", el teclado se limpia y no avanza; el bloqueo lo decide la base, no el front. (Test en Task 1 y Task 7.)
5. **Envasado en cola de una fabricación con otro envasado terminando** → al finalizar uno, la fabricación no se cierra sola mientras queden hermanos en cola/activos/pausados (si no, el de la cola queda huérfano con `TANQUE_NO_LISTO`). (Test en Task 1.)

---

## File Structure

```
supabase/migrations/20261021000006_produccion_tablet.sql   # v_tareas, verificar_pin, accion (auto-cierre)
supabase/tests/tablet.test.sql
src/lib/database.types.ts        # + v_tareas, verificar_pin
src/lib/acciones.ts              # ejecutarAccion, verificarPin
src/lib/useRealtime.ts           # conectado (red) vs enVivo (canal), recargar(), topic único
src/domain/tareas.ts             # clasificar, estado de operaria, cronómetro, etiquetas
src/planta/useInactividad.ts
src/planta/AnilloInactividad.tsx
src/planta/QuienTrabaja.tsx
src/planta/TecladoPin.tsx
src/planta/TarjetaTarea.tsx
src/planta/MisTareas.tsx
src/planta/Confirmacion.tsx
src/planta/PlantaApp.tsx         # máquina de pantallas; reemplaza pages/PlantaInicio
src/planta/planta.css
e2e/planta.spec.ts  playwright.config.ts
```

---

### Task 1: Migración 006 — `v_tareas`, `verificar_pin` y auto-cierre seguro

**Files:**
- Create: `supabase/migrations/20261021000006_produccion_tablet.sql`, `supabase/tests/tablet.test.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Produces:
  - Vista `produccion.v_tareas` (`security_invoker = true`, grant select a authenticated). Una fila por tarea abierta, unión de las tres entidades:
    `entidad text, id uuid, estado text, producto text null, color text null, tanque_codigo text null, presentacion text null, cantidad int null, litros numeric null, lote text null, descripcion text null, operaria_1 uuid null, operaria_2 uuid null, listo boolean, inicio timestamptz null, min_efectivos numeric null, corriendo boolean, created_at timestamptz`.
    - fabricación: estados `cola|fabricando|pausada`; `operaria_1 = operaria_id`; `listo = true`; `presentacion/cantidad = null`.
    - envasado: estados `cola|activo|pausado`; producto/color/tanque/litros de su fabricación; `listo = (fabricación.estado = 'para_envasar')`.
    - fraccionado: estados `cola|activo|pausado`; `operaria_1 = operaria_id`; producto/presentación si están; `tanque_codigo = null`; `listo = true`.
    - `min_efectivos` de `v_tiempos_efectivos` (null si nunca se inició); `corriendo = estado in ('fabricando','activo')`.
  - `produccion.verificar_pin(p_empleado_id uuid, p_pin text) returns jsonb` — `security definer`, `search_path = ''`. Sin rol → `{ok:false,codigo:'NO_AUTORIZADO'}`; operaria inactiva (mismo criterio que `accion`) → `OPERARIA_INACTIVA`; luego `_verificar_pin`: `'ok'` → `{ok:true}`, `'bloqueado'` → `PIN_BLOQUEADO`, otro → `PIN_INCORRECTO`. Nunca lanza (los intentos persisten). Grant execute a authenticated; revoke de public/anon.
  - `accion()` (create or replace, misma firma): el auto-cierre de la fabricación al finalizar un envasado ocurre **solo si** no quedan otros envasados de esa fabricación en `cola|activo|pausado`; el evento automático guarda `empleado_id = p_empleado_id`.

- [ ] **Step 1: Escribir `tablet.test.sql`** — `plan(7)`, como `U_TABLET` salvo indicación:
  - `verificar_pin(E1,'1234')` → `ok = true`
  - `verificar_pin(E1,'9999')` → `codigo = 'PIN_INCORRECTO'` y, como postgres, `pin_intentos = 1`
  - 5 × `verificar_pin(E2,'9999')` y luego `'1234'` → `PIN_BLOQUEADO`
  - `verificar_pin(E3,'1234')` → `OPERARIA_INACTIVA`
  - escenario: fabricación `para_envasar` 10 L en `T-TEST` con envasado A `activo` (E1, 3 × `5L-test`) y envasado B `cola`; E1 finaliza A → `fabricacion_cerrada = false`, fabricación sigue `para_envasar`
  - `v_tareas`: la fila de B tiene `listo = true`, `tanque_codigo = 'T-TEST'`, `producto = 'Lavandina-test'`; una fabricación en `cola` en otro tanque aparece con `entidad = 'fabricacion'`
  - como `U_OTRO`: `count(*) from v_tareas` = 0
- [ ] **Step 2: Correr y ver fallar** (`verificar_pin`/`v_tareas` inexistentes).
- [ ] **Step 3: Escribir la migración.** `accion` se copia de la migración 005 cambiando solo el bloque de auto-cierre (condición `not exists` de hermanos abiertos) y el `empleado_id` del evento automático.
- [ ] **Step 4: Ensayar** migración + fixtures + test en `begin … rollback` → `ok 1..7`.
- [ ] **Step 5: Pedir OK y aplicar** — `apply_migration('produccion_tablet', …)`; `get_advisors(type:'security')` sin hallazgos nuevos en `produccion`.
- [ ] **Step 6: Correr el test contra lo aplicado** → `ok 1..7`; además re-correr `rpc.test.sql` → `ok 1..12` (regresión de `accion`).
- [ ] **Step 7: Tipos** — agregar `v_tareas` (Views) y `verificar_pin` (Functions, `Returns: Json`) a `database.types.ts`; `npm run typecheck` limpio.
- [ ] **Step 8: Commit** — `git commit -m "feat(db): v_tareas, verificar_pin y auto-cierre que respeta envasados pendientes"`

---

### Task 2: Dominio de tareas

**Files:**
- Create: `src/domain/tareas.ts`, `src/domain/tareas.test.ts`

**Interfaces:**
- Consumes: `Accion`, `Entidad` de `src/domain/acciones.ts`.
- Produces:
  - `type Tarea` = fila de `v_tareas` (`Database['produccion']['Views']['v_tareas']['Row']`).
  - `clasificarTareas(tareas: Tarea[], empleadoId: string, tanque?: string | null): { mias: Tarea[]; disponibles: Tarea[] }` — `mias`: `operaria_1` u `operaria_2` = `empleadoId` (cualquier estado abierto). `disponibles`: `estado = 'cola'`, `operaria_1` null, `listo`. Orden en ambas: primero las de `tanque_codigo === tanque`, luego `corriendo`, luego `created_at` ascendente.
  - `estadoOperaria(tareas: Tarea[], empleadoId: string): 'trabajando' | 'pausada' | null` — alguna suya `corriendo` → trabajando; si no, alguna suya en `pausada|pausado` → pausada.
  - `segundosTranscurridos(t: Pick<Tarea,'min_efectivos'|'corriendo'>, cargadoEn: number, ahora: number): number` — `round(min_efectivos·60) + (corriendo ? floor((ahora − cargadoEn)/1000) : 0)`; null → 0.
  - `formatoCronometro(seg: number): string` — `< 3600` → `MM:SS`; si no `H:MM:SS`.
  - `etiquetaAccion(accion: Accion, disponible: boolean): string` — iniciar → `disponible ? 'Tomar' : 'Iniciar'`; pausar 'Pausar'; reanudar 'Reanudar'; finalizar 'Finalizar'; cancelar 'Cancelar'.
  - `pasadoAccion(accion: Accion): string` — iniciar 'empezaste', pausar 'pausaste', reanudar 'retomaste', finalizar 'finalizaste', cancelar 'cancelaste'.
  - `tituloTarea(t: Tarea): string` — fabricación `"<producto> · <litros> L"`; envasado `"<producto> · <cantidad> × <presentacion>"`; fraccionado `descripcion ?? producto ?? 'Fraccionado'`.

- [ ] **Step 1: Tests** (fábrica `tarea(over: Partial<Tarea>): Tarea` en el test):
  - `clasificarTareas`: tarea con `operaria_2 = 'E1'` va a `mias` de E1; cola sin operaria y `listo=false` no está en `disponibles`; cola con `operaria_1='E2'` no está en `disponibles` de E1; con `tanque='T-03'` la de `T-03` queda primera aunque sea la más nueva.
  - `estadoOperaria`: una corriendo + una pausada → `'trabajando'`; solo pausada → `'pausada'`; ninguna → `null`.
  - `segundosTranscurridos({min_efectivos: 2, corriendo: true}, 0, 5000)` → `125`; `corriendo:false` → `120`; `min_efectivos: null` → `0`.
  - `formatoCronometro(65)` → `'01:05'`; `(3725)` → `'1:02:05'`.
  - `etiquetaAccion('iniciar', true)` → `'Tomar'`; `pasadoAccion('finalizar')` → `'finalizaste'`.
  - `tituloTarea` envasado `{producto:'Lavandina', cantidad: 120, presentacion:'5L'}` → `'Lavandina · 120 × 5L'`.
- [ ] **Step 2: Ver fallar** — `npx vitest --run src/domain/tareas`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(domain): clasificación de tareas, cronómetro y etiquetas"`

---

### Task 3: Capa de datos de la tablet

**Files:**
- Create: `src/lib/acciones.ts`, `src/lib/acciones.test.ts`
- Modify: `src/lib/useRealtime.ts`, `src/lib/useRealtime.test.ts`, `src/pages/ParedTanques.tsx` (usar `conectado` como red)

**Interfaces:**
- Consumes: `db` (`src/lib/supabase.ts`), `mensajeError`, `CodigoError`.
- Produces:
  - `type Resultado<T = object> = ({ ok: true } & T) | { ok: false; codigo: CodigoError; texto: string }`
  - `verificarPin(empleadoId: string, pin: string): Promise<Resultado>`
  - `ejecutarAccion(p: { entidad: Entidad; id: string; accion: Accion; empleadoId: string; pin: string }): Promise<Resultado<{ fabricacionCerrada: boolean }>>` — `{error}` de PostgREST, `{ok:false}` de la RPC y excepciones de red se normalizan con `mensajeError`.
  - `useRealtime` pasa a devolver `{ datos, conectado, enVivo, error, recargar }`: `conectado` = red (`navigator.onLine` + eventos), `enVivo` = canal `SUBSCRIBED`; `recargar(): void` dispara una carga inmediata; al pasar `online` de false a true recarga. Topic del canal con sufijo único por montaje (`useId`). La banda de `ParedTanques` sigue usando `!conectado`.
- [ ] **Step 1: Tests `acciones.test.ts`** (mock de `./supabase` con `db.rpc` configurable):
  - rpc devuelve `{data:{ok:true, fabricacion_cerrada:true}}` → `{ok:true, fabricacionCerrada:true}`
  - rpc devuelve `{data:{ok:false,codigo:'TRANSICION_INVALIDA',detalle:'ya la finalizó Laura Paz a las 14:02'}}` → `texto: 'Esta tarea ya la finalizó Laura Paz a las 14:02.'`
  - rpc rechaza con `TypeError('Failed to fetch')` → `codigo:'RED'`
  - `verificarPin` con `{data:{ok:false,codigo:'PIN_BLOQUEADO'}}` → `texto:'Demasiados intentos. Esperá un minuto.'`
  - `ejecutarAccion` llama `db.rpc('accion', {p_entidad, p_id, p_accion, p_empleado_id, p_pin})` con esos nombres exactos.
- [ ] **Step 2: Tests `useRealtime.test.ts`** (agregar):
  - canal que nunca llega a `SUBSCRIBED` → `enVivo=false`, `conectado=true`
  - evento `offline` → `conectado=false`; `online` → `conectado=true` y `cargar` se llama otra vez
  - `recargar()` llama a `cargar`
- [ ] **Step 3: Ver fallar** — `npx vitest --run src/lib`.
- [ ] **Step 4: Implementar.**
- [ ] **Step 5: Ver pasar** + suite completa (`npx vitest --run`) + `npm run typecheck`.
- [ ] **Step 6: Commit** — `git commit -m "feat: acciones de tablet y useRealtime con red, canal y recarga"`

---

### Task 4: Inactividad de 30 s

**Files:**
- Create: `src/planta/useInactividad.ts`, `src/planta/useInactividad.test.ts`, `src/planta/AnilloInactividad.tsx`

**Interfaces:**
- Produces:
  - `useInactividad(activo: boolean, ms: number, alExpirar: () => void): number` — devuelve fracción restante 0..1 (refresco cada 250 ms). `pointerdown` y `keydown` en `window` reinician el plazo. Con `activo=false` no corre y devuelve 1.
  - `<AnilloInactividad restante={number} />` — SVG circular 44 px, `stroke-dashoffset` proporcional, `role="timer"`, `aria-label="Cierre automático en N segundos"`.
- [ ] **Step 1: Tests** (`vi.useFakeTimers()`, `renderHook`):
  - a los 30 000 ms sin eventos `alExpirar` se llama una vez
  - un `pointerdown` a los 20 000 ms → a los 45 000 ms todavía no expiró; a los 50 000 ms sí
  - a los 15 000 ms devuelve ≈ 0.5 (± 0.02)
  - `activo=false` → nunca expira
- [ ] **Step 2: Ver fallar.** **Step 3: Implementar.** **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(planta): cierre automático por inactividad con anillo"`

---

### Task 5: ¿Quién trabaja? y teclado de PIN

**Files:**
- Create: `src/planta/QuienTrabaja.tsx`, `src/planta/TecladoPin.tsx`, `src/planta/planta.test.tsx`, `src/planta/planta.css`

**Interfaces:**
- Consumes: `estadoOperaria` (Task 2); fila de `v_operarias` (`OperariaFila = Database['produccion']['Views']['v_operarias']['Row']`).
- Produces:
  - `<QuienTrabaja operarias: OperariaFila[]; tareas: Tarea[]; onElegir(o: OperariaFila): void />` — grilla de botones (avatar con `foto_url` o iniciales sobre `color_avatar`, nombre); punto `.punto-trabajando` (verde) / `.punto-pausada` (naranja) según `estadoOperaria`; entrada escalonada con motion (sin ella en reduced motion). Orden alfabético por `nombre`.
  - `<TecladoPin nombre: string; error: string | null; ocupado: boolean; onCompleto(pin: string): void; onVolver(): void />` — 4 puntos, teclas 1-9, "Borrar", 0, "Volver"; al 4.º dígito llama `onCompleto` y deshabilita teclas mientras `ocupado`; cuando cambia `error` a no-null: limpia los dígitos, muestra el texto con `role="alert"` y aplica clase `.sacudir` (no en reduced motion). También acepta teclado físico (dígitos y Backspace).
- [ ] **Step 1: Tests `planta.test.tsx`:**
  - `QuienTrabaja`: muestra los nombres ordenados; clic en "Rosa Díaz" llama `onElegir` con su fila; operaria con tarea corriendo tiene `.punto-trabajando`
  - `TecladoPin`: tocar 1,2,3,4 → `onCompleto('1234')` una vez; "Borrar" quita el último dígito; con `error='PIN incorrecto. Probá de nuevo.'` el alert muestra ese texto y los 4 puntos quedan vacíos
- [ ] **Step 2: Ver fallar.** **Step 3: Implementar** (estilos en `planta.css`, teclas ≥ 72 px). **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(planta): selección de operaria y teclado de PIN"`

---

### Task 6: Mis tareas, tarjeta y confirmación

**Files:**
- Create: `src/planta/TarjetaTarea.tsx`, `src/planta/MisTareas.tsx`, `src/planta/Confirmacion.tsx`, `src/planta/tareas.test.tsx`
- Modify: `src/planta/planta.css`

**Interfaces:**
- Consumes: `clasificarTareas`, `segundosTranscurridos`, `formatoCronometro`, `etiquetaAccion`, `tituloTarea` (Task 2); `accionesPosibles` (plan 1); `<Tanque>`, `<Chip>`, `nivelTanque`.
- Produces:
  - `<TarjetaTarea tarea: Tarea; disponible: boolean; habilitado: boolean; cargadoEn: number; onAccion(a: Accion): void />` — mini `<Tanque ancho={44}>` (si hay `tanque_codigo`), título, `tanque_codigo`, `<Chip>`, cronómetro (`role="timer"`, tic cada 1 s solo si `corriendo`), y un botón por `accionesPosibles(entidad, estado,'planta')` (en disponibles solo `iniciar`, rotulado "Tomar"); botones `disabled` si `!habilitado`; alto ≥ 64 px.
  - `<MisTareas nombre: string; tareas: Tarea[]; empleadoId: string; tanque: string | null; conectado: boolean; cargadoEn: number; aviso: string | null; onAccion(t: Tarea, a: Accion): void; onSalir(): void />` — encabezado "Hola, <nombre>" + botón "No soy yo"; secciones "Mis tareas" y "Disponibles para tomar" (vacías → "No tenés tareas en curso." / "No hay tareas para tomar."); `aviso` en `role="alert"`; banda "Sin conexión — no se pueden registrar acciones." si `!conectado`.
  - `<Confirmacion color: string; texto: string; onFin(): void />` — check dibujado (stroke) + estallido circular del color; llama `onFin` a los 1200 ms (0 ms en reduced motion).
- [ ] **Step 1: Tests `tareas.test.tsx`:**
  - con `conectado=false` todos los botones de acción están `disabled` y se ve la banda
  - con `tanque='T-03'` la primera tarjeta de "Disponibles" es la de `T-03`
  - tarjeta disponible muestra "Tomar" y al tocarlo `onAccion(tarea,'iniciar')`
  - tarjeta `fabricando` muestra "Pausar" y "Finalizar", nunca "Cancelar"
  - cronómetro: con fake timers, `min_efectivos: 1, corriendo: true`, `cargadoEn = Date.now()` → muestra `01:00` y tras 5 s `01:05`
  - `Confirmacion` con `matchMedia` reduced-motion mockeado → `onFin` llamado sin esperar
- [ ] **Step 2: Ver fallar.** **Step 3: Implementar.** **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** — `git commit -m "feat(planta): mis tareas, disponibles, cronómetro y confirmación"`

---

### Task 7: Flujo completo en `/planta`

**Files:**
- Create: `src/planta/PlantaApp.tsx`, `src/planta/PlantaApp.test.tsx`
- Modify: `src/App.tsx` (ruta `/planta` → `PlantaApp`), delete `src/pages/PlantaInicio.tsx`

**Interfaces:**
- Consumes: todo lo anterior; `useRealtime` sobre `v_operarias` (canales `[]`, solo carga + polling) y `v_tareas` (canales `['fabricaciones','envasados','fraccionados']`); `verificarPin`, `ejecutarAccion`; `useSearchParams` para `tanque`.
- Produces: `<PlantaApp />` con estado `{ pantalla: 'quien' | 'pin' | 'tareas' | 'confirmacion'; operaria: OperariaFila | null; pin: string | null; aviso: string | null; confirmacion: {color, texto} | null }`:
  - quien → elegir → pin; PIN completo → `verificarPin`; ok → tareas (guarda pin en estado); error → `TecladoPin.error = texto`.
  - tareas → `onAccion` → `ejecutarAccion` con el pin guardado; ok → confirmacion (`color` del producto o `#0f172a`, texto `` `Listo: ${pasadoAccion(a)} ${tituloTarea(t)}` `` p. ej. "Listo: finalizaste Lavandina · 1200 L") → al terminar vuelve a tareas y `recargar()`; error → `aviso = texto` y `recargar()`; si el código es `PIN_BLOQUEADO`/`PIN_INCORRECTO` (PIN cambiado por la encargada) → vuelve a pin con ese error.
  - "No soy yo", inactividad 30 s (activa en pin y tareas) → quien, borra operaria y pin.
  - Encabezado de dispositivo con marca, hora y `<AnilloInactividad>` cuando corre; el "Salir" del usuario-dispositivo queda en un menú discreto (no visible para operarias): mantener presionado el logo 2 s.
- [ ] **Step 1: Tests `PlantaApp.test.tsx`** (mocks de `../lib/acciones` y `../lib/useRealtime`; `MemoryRouter` con `/planta?tanque=T-03`):
  - flujo feliz: elegir "Laura Paz" → teclear 1234 → ve "Hola, Laura Paz" → "Finalizar" en su tarea → `ejecutarAccion` llamado con `{entidad:'fabricacion', accion:'finalizar', empleadoId:'E1', pin:'1234', id}` → aparece la confirmación
  - PIN incorrecto → mensaje "PIN incorrecto. Probá de nuevo." y sigue en el teclado
  - PIN bloqueado → "Demasiados intentos. Esperá un minuto."
  - acción rechazada `TRANSICION_INVALIDA` → alert "Esta tarea ya la finalizó Rosa Díaz a las 10:15.", **sin** confirmación, y `recargar` llamado
  - inactividad (fake timers) 30 s en tareas → vuelve a "¿Quién trabaja?"; elegir otra vez a Laura pide PIN de nuevo (el pin anterior no se reutiliza)
- [ ] **Step 2: Ver fallar.** **Step 3: Implementar.** **Step 4: Ver pasar** + suite completa + typecheck + build.
- [ ] **Step 5: Commit** — `git commit -m "feat(planta): flujo operaria → PIN → tareas → confirmación"`

---

### Task 8: E2E, verificación visual y publicación

**Files:**
- Create: `playwright.config.ts`, `e2e/planta.spec.ts`, `e2e/mocks.ts`
- Modify: `package.json` (script `e2e`, devDependency `@playwright/test`), `.github/workflows/deploy.yml` (sin cambios de pasos; e2e corre local), `.gitignore` (`test-results/`, `playwright-report/`)

**Interfaces:**
- Consumes: la app completa. Las llamadas a Supabase se interceptan con `page.route('**/auth/v1/**' | '**/rest/v1/**')` en `e2e/mocks.ts` (sesión falsa del usuario-dispositivo en `localStorage['prodcontrol_auth']`, `perfiles` → `rol_produccion:'planta'`, `v_operarias`, `v_tareas`, `rpc/verificar_pin`, `rpc/accion`); **nunca** contra la base real.
- [ ] **Step 1: Instalar** — `npm i -D @playwright/test && npx playwright install chromium`; `playwright.config.ts` con `webServer: npm run dev -- --port 5180`, `baseURL http://localhost:5180/Produccion/`, viewport 1180×820.
- [ ] **Step 2: Escribir `planta.spec.ts`** — persona → PIN `1234` → "Tomar" en una disponible → confirmación → vuelve a "Mis tareas" con la tarea en curso (el mock de `v_tareas` devuelve el estado nuevo tras el `rpc/accion`) → "Finalizar" → confirmación. Captura `e2e/planta-1180.png`.
- [ ] **Step 3: Correr** — `npm run e2e` → 1 passed. Revisar la captura: nada cortado, botones ≥ 64 px.
- [ ] **Step 4: Verificación real con el usuario** — `npm run dev`; el usuario entra con la tablet (`tablet-planta-1@subatir.local`) y opera con una operaria real que la encargada haya dado de alta con PIN (pedirle al usuario cuál; si no hay ninguna, pedir OK para crear una operaria de prueba vinculada a un funcionario de Producción y borrarla al final). Probar `?tanque=T-01`, PIN incorrecto, inactividad.
- [ ] **Step 5: Commit** — `git commit -m "test(e2e): flujo de tablet con Playwright"`
- [ ] **Step 6: Publicar (OK del usuario)** — merge `--ff-only` a `main`, push con la cuenta `alechiesasubatir-bit` (`gh auth switch`, volver a `achiesa77-ctrl` al final), esperar el workflow y abrir `https://alechiesasubatir-bit.github.io/Produccion/planta`.
