# Varias operarias por orden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que varias operarias trabajen en una misma orden, entren y salgan declarando lo envasado, que el vencimiento lo carguen tablet y panel, y que el etiquetado sea Sí/No + catálogo.

**Architecture:** Tabla `produccion.participaciones` (una fila por operaria por tramo en una orden) escrita solo desde RPC `security definer`; `accion()` suma `sumarse`/`salir` y recibe cantidades. Las vistas exponen `operarias`/`participaciones` como jsonb; la tablet y el panel leen de ahí. Catálogo `etiquetas` con `etiqueta_id` en envasados/fraccionados.

**Tech Stack:** Postgres/Supabase (plpgsql, pgTAP vía `execute_sql`), React 19 + TS, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-operarias-multiples-design.md`

## Global Constraints

- Migración nueva: `supabase/migrations/20261111000014_produccion_operarias_multiples.sql`. Producción (`iyqufnmpjkyfzspujwyf`): NO aplicar sin OK explícito del usuario. La 013 tampoco está aplicada.
- Tests SQL contra la base real: `begin;` + contenido de 013 + 014 + `_fixtures.sql` + el test + `select * from _tap; rollback;` en un solo `execute_sql` (nunca commitea).
- RPC no lanzan errores de negocio: devuelven `{ok:false, codigo, detalle}` (errores internos con SQLSTATE `PC001`).
- Columnas nuevas de vistas SIEMPRE al final (`create or replace view`).
- `src/lib/database.types.ts` se edita a mano.
- Repo público: fixtures con datos inventados (T-TEST, Lavandina-test, 5L-test).
- Códigos de error nuevos y textos (exactos): `YA_PARTICIPA` «Ya estás en esta orden.», `NO_PARTICIPA` «No estás en esta orden.», `ULTIMA_OPERARIA` «Sos la última: pausá o finalizá.», `CANTIDAD_REQUERIDA` «Falta declarar cuánto se envasó.», `ETIQUETA_INACTIVA` «Esa etiqueta está desactivada.».
- Unidad por defecto: `kg` si `producto_tipo = 'polvo'`, si no `L`.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Dos tablets a la vez: una operaria sale mientras otra finaliza la misma orden → la fila de la orden se bloquea (`for update`) antes de tocar participaciones; el segundo pedido ve el estado nuevo y responde `TRANSICION_INVALIDA` o `NO_PARTICIPA`, nunca deja participaciones abiertas en una orden cerrada. Test en Task 2.
2. Cantidad con coma decimal («12,5») en el teclado → se guarda 12.5; «0», vacío o negativo no habilitan Confirmar. Test en Task 6.
3. La encargada finaliza o cancela desde el panel una orden con operarias adentro sin declarar → se permite; quedan cerradas con `cantidad null`, el detalle muestra «Falta declarar» y `corregir_cantidad` permite cargarla. Tests en Tasks 2, 3 y 9.
4. Sumarse a un envasado estando en otro envasado abierto → `OPERARIA_OCUPADA` (misma regla que `iniciar` hoy). Test en Task 2.
5. Órdenes viejas sin participaciones (finalizadas antes de 014) → historial y detalle muestran `operaria_1`/`operaria_2` como hoy, sin «Falta declarar». Test en Task 10.

---

### Task 1: Esquema — participaciones, etiquetas, eventos y migración de datos

**Files:**
- Create: `supabase/migrations/20261111000014_produccion_operarias_multiples.sql` (primera sección; Tasks 2–4 agregan secciones)
- Create: `supabase/tests/participaciones.test.sql`
- Modify: `supabase/tests/_fixtures.sql` (agregar etiqueta `Etiqueta-test` activa `…0e7` e inactiva `…0e8`)

**Interfaces:**
- Produces: tabla `produccion.participaciones (id, entidad, entidad_id, empleado_id, desde, hasta, cantidad numeric, unidad text check in ('L','kg'), cantidad_corregida, corregida_por, corregida_at)`; índice único parcial `participaciones_abierta_uk (entidad, entidad_id, empleado_id) where hasta is null`; tabla `produccion.etiquetas (id, nombre unique, activo, created_at)`; `envasados.etiqueta_id`, `fraccionados.etiqueta_id`; `eventos.accion` admite `sumarse`, `salir`, `corregir`; función interna `produccion._abrir_participacion(p_entidad text, p_id uuid, p_empleado uuid) returns void`.

- [ ] **Step 1: Tests** en `participaciones.test.sql` (plan inicial 6): tabla existe con RLS; doble participación abierta misma operaria → `unique_violation`; planta no puede `insert` directo (`42501`); etiqueta inactiva en `envasados.etiqueta_id` → excepción con mensaje `ETIQUETA_INACTIVA`; un envasado `activo` con `operaria_1` existente antes de la migración queda con 1 participación abierta y `desde = inicio` (crear la fila en el test antes de ejecutar la sección de migración de datos — por eso la migración de datos va en una función `produccion._migrar_participaciones()` que la migración llama al final y el test puede llamar de nuevo); evento `accion='sumarse'` se inserta sin error.
- [ ] **Step 2: Correr** (begin + 013 + 014 + fixtures + test + rollback) → FAIL (tabla no existe).
- [ ] **Step 3: Escribir la sección de esquema.** RLS: `select` para `es_panel() or es_planta()`; sin grants de escritura en participaciones. Etiquetas: mismas policies/grants que `presentaciones` (lectura panel+planta, escritura panel). Grants de insert/update de `etiqueta_id` al panel en envasados/fraccionados. Trigger `before insert or update of etiqueta_id` que lanza `ETIQUETA_INACTIVA` (SQLSTATE `PC001`). Agregar `participaciones` y `etiquetas` a `supabase_realtime`. `_migrar_participaciones()` idempotente (no inserta si ya hay abierta).
- [ ] **Step 4: Correr** → PASS 6/6. Correr también `tablas.test.sql` y `rls.test.sql` → PASS.
- [ ] **Step 5: Commit** `feat(db): participaciones y etiquetas (014, esquema)`.

### Task 2: `accion()` con sumarse/salir y cantidades; `cargar_mp()` por participación

**Files:**
- Modify: `supabase/migrations/20261111000014_produccion_operarias_multiples.sql` (sección RPC)
- Modify: `supabase/tests/participaciones.test.sql`, `supabase/tests/rpc.test.sql`, `supabase/tests/tablet.test.sql`, `supabase/tests/formula_mp.test.sql` (llamadas a la firma nueva; quitar asserts de PIN que 013 ya dejó sin sentido)

**Interfaces:**
- Consumes: Task 1.
- Produces: `produccion.accion(p_entidad text, p_id uuid, p_accion text, p_empleado_id uuid default null, p_pin text default null, p_cantidades jsonb default null) returns jsonb` (se hace `drop function` de la firma de 5 args). `p_cantidades = [{"empleado_id": uuid, "cantidad": number, "unidad": "L"|"kg"}]`. Acciones válidas: `iniciar|sumarse|salir|pausar|reanudar|finalizar|cancelar`. `cargar_mp` misma firma, regla nueva.

- [ ] **Step 1: Tests** (sumar al plan): iniciar abre participación; sumarse abre la segunda y deja evento `sumarse`; sumarse dos veces → `YA_PARTICIPA`; sumarse en cola → `TRANSICION_INVALIDA`; sumarse a envasado estando en otro envasado abierto → `OPERARIA_OCUPADA`; salir sin cantidad en envasado → `CANTIDAD_REQUERIDA`; salir con `[{e1, 120, 'L'}]` cierra con cantidad y evento `salir` con `datos = {cantidad:120, unidad:'L'}`; salir siendo la única → `ULTIMA_OPERARIA`; salir sin participar → `NO_PARTICIPA`; salir en fabricación sin cantidades → ok; finalizar envasado con 2 abiertas y 1 cantidad → `CANTIDAD_REQUERIDA`; con 2 → cierra ambas y estado `finalizado`; planta pausar sin participar → `NO_PARTICIPA`; planta pausar en orden sin participaciones abiertas → ok y le abre participación; panel finalizar sin cantidades → ok, participaciones cerradas con `cantidad null`; cancelar (panel) cierra todas; tras finalizar, un `salir` de la otra operaria → `TRANSICION_INVALIDA`; auto-cierre de fabricación (último envasado finalizado) deja 0 participaciones abiertas de la fabricación; `cargar_mp` por la segunda operaria → ok y `cargado_por` = ella; por una que no participa → `NO_PARTICIPA`.
- [ ] **Step 2: Correr** → FAIL.
- [ ] **Step 3: Implementar** partiendo del cuerpo de `accion()` de 013. Orden dentro del bloque atómico: bloquear la orden → validar transición (`sumarse`/`salir` válidos en `fabricando|pausada|activo|pausado`, no cambian estado) → validar participación (desde planta) → aplicar estado → participaciones → evento. `iniciar` sigue llenando `operaria_id`/`operaria_1`. Cantidades: `> 0`, unidad en (`L`,`kg`); solo exigidas desde planta.
- [ ] **Step 4: Correr** todos los `.test.sql` → PASS.
- [ ] **Step 5: Commit** `feat(db): accion() con sumarse/salir y cantidades por operaria`.

### Task 3: `corregir_cantidad()` y `set_vencimiento()`

**Files:**
- Modify: migración 014 (sección RPC), `supabase/tests/participaciones.test.sql`

**Interfaces:**
- Produces: `produccion.corregir_cantidad(p_participacion_id uuid, p_cantidad numeric, p_unidad text default null) returns jsonb`; `produccion.set_vencimiento(p_fab_id uuid, p_fecha date, p_empleado_id uuid default null) returns jsonb`. Grants `execute` a `authenticated`.

- [ ] **Step 1: Tests:** corregir desde planta → `NO_AUTORIZADO`; desde panel sobre cerrada con 120 → `cantidad_corregida=115`, `corregida_por`=uid, evento `corregir` con `{participacion_id, antes:120, despues:115}`; sobre abierta → `TRANSICION_INVALIDA`; sobre cerrada con `cantidad null` (Review Focus 3) → ok y guarda `cantidad_corregida` (y `unidad` si viene); `set_vencimiento` desde planta participando → ok, evento `editar` con `empleado_id` y `datos.vencimiento = {antes, despues}`; desde planta sin participar → `NO_PARTICIPA`; sobre fabricación `finalizada` → `TRANSICION_INVALIDA`; desde panel → ok.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit** `feat(db): corregir cantidades y vencimiento desde la tablet`.

### Task 4: Vistas `v_tareas`, `v_flujo`, `v_historial`

**Files:**
- Modify: migración 014 (sección vistas, partiendo de las definiciones de 012 y 010), `supabase/tests/vistas.test.sql`, `supabase/tests/analisis.test.sql`

**Interfaces:**
- Produces (al final de cada vista): `v_tareas` y `v_flujo` + `operarias jsonb` (`[{empleado_id, nombre, desde}]` abiertas, orden por `desde`; `'[]'` si no hay) + `etiqueta text` (nombre; null en fabricación o sin etiqueta); `v_tareas` además + `vencimiento date` (de la fabricación; null en fraccionado). `v_historial` + `participaciones jsonb` (`[{empleado_id, nombre, desde, hasta, cantidad, unidad, cantidad_corregida, minutos}]`, todas) + `etiqueta text`. `minutos` = tramo menos superposición con pausas de la orden (pares `pausar`→`reanudar` de `eventos`).

- [ ] **Step 1: Tests:** `v_tareas.operarias` con 2 abiertas en orden de `desde`; `'[]'` sin participaciones; `etiqueta` = 'Etiqueta-test'; `v_historial.participaciones` incluye cerradas con cantidad corregida; `minutos` de un tramo de 60 min con una pausa de 20 adentro = 40.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** todos los `.test.sql` → PASS.
- [ ] **Step 5: Commit** `feat(db): vistas con operarias, participaciones y etiqueta`.

### Task 5: Tipos y cliente (`database.types`, errores, acciones)

**Files:**
- Modify: `src/lib/database.types.ts`, `src/lib/errores.ts`, `src/domain/acciones.ts`, `src/lib/acciones.ts`, `src/lib/acciones.test.ts`, `src/domain/acciones.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (columnas y firmas).
- Produces:
  - `type Accion = 'iniciar' | 'sumarse' | 'salir' | 'pausar' | 'reanudar' | 'finalizar' | 'cancelar'`
  - `type Unidad = 'L' | 'kg'`; `type Cantidad = { empleadoId: string; cantidad: number; unidad: Unidad }`
  - `type OperariaEnOrden = { empleado_id: string; nombre: string; desde: string }`; `type Participacion = OperariaEnOrden & { hasta: string | null; cantidad: number | null; unidad: Unidad | null; cantidad_corregida: number | null; minutos: number }` (en `database.types.ts`, columnas `operarias: OperariaEnOrden[]`, `participaciones: Participacion[]`, `etiqueta: string | null`; `etiqueta_id` en envasados/fraccionados; tabla `etiquetas`)
  - `ejecutarAccion(p: { entidad; id; accion; empleadoId; cantidades?: Cantidad[] })` (mapea a `p_cantidades` con `empleado_id`)
  - `accionPanel(p: { entidad; id; accion })` sin cambios
  - `corregirCantidad(p: { participacionId: string; cantidad: number; unidad?: Unidad }): Promise<Resultado>`
  - `setVencimiento(p: { fabricacionId: string; fecha: string; empleadoId?: string }): Promise<Resultado>`
  - `accionesPosibles(entidad, estado, rol)` sin cambios de firma; NO devuelve `sumarse`/`salir` (los decide la tablet según participación, Task 6).

- [ ] **Step 1: Tests:** `ejecutarAccion` con cantidades llama `rpc('accion', {…, p_cantidades: [{empleado_id:'e1', cantidad:12.5, unidad:'L'}]})`; sin cantidades no manda `p_cantidades`; `corregirCantidad` y `setVencimiento` llaman sus RPC con `p_participacion_id/p_cantidad/p_unidad` y `p_fab_id/p_fecha/p_empleado_id`; `mensajeError({codigo:'ULTIMA_OPERARIA'})` → texto exacto de Global Constraints (los 5 códigos).
- [ ] **Step 2: `npx vitest run src/lib src/domain/acciones.test.ts`** → FAIL. **Step 3: Implementar** (`llamar` admite `'corregir_cantidad' | 'set_vencimiento'` y args `unknown`). **Step 4:** PASS + `npm run typecheck` sin errores nuevos fuera de los archivos de Tasks 6–11 (anotarlos).
- [ ] **Step 5: Commit** `feat(cliente): tipos y llamadas para participaciones`.

### Task 6: Dominio de tareas y teclado de cantidad (tablet)

**Files:**
- Modify: `src/domain/tareas.ts`, `src/domain/tareas.test.ts`
- Create: `src/planta/DeclararCantidad.tsx`, `src/planta/declararCantidad.test.tsx`

**Interfaces:**
- Produces:
  - `clasificarTareas(tareas, empleadoId, tanque?) → { mias: Tarea[]; enCurso: Tarea[]; disponibles: Tarea[] }` — `mias` = `operarias` contiene a la operaria; `enCurso` = estado en `fabricando|pausada|activo|pausado` y no la contiene; `disponibles` como hoy (`cola`, `listo`, sin operaria).
  - `estadoOperaria` usa `operarias` en vez de `operaria_1/2`.
  - `esUltima(t: Tarea, empleadoId: string): boolean`
  - `unidadPorDefecto(t: Pick<Tarea, 'producto_tipo'>): Unidad`
  - `pideCantidad(entidad: Entidad): boolean` (true en envasado/fraccionado)
  - `parsearCantidad(texto: string): number | null` (acepta coma o punto; null si vacío, ≤ 0 o no numérico)
  - `<DeclararCantidad personas={OperariaEnOrden[]} unidadInicial={Unidad} titulo={string} onConfirmar={(c: Cantidad[]) => void} onCancelar={() => void} />` — un campo por persona (uno solo al salir), botones L/kg, Confirmar deshabilitado hasta que todas parseen.

- [ ] **Step 1: Tests:** clasificación con una tarea donde está, una en curso ajena, una en cola; `esUltima` true/false; `unidadPorDefecto({producto_tipo:'polvo'})='kg'`; `parsearCantidad('12,5')=12.5`, `('0')=null`, `('')=null`, `('-3')=null`, `('abc')=null`; componente: con 2 personas, Confirmar deshabilitado con un campo vacío, habilitado con ambos, llama `onConfirmar` con `[{empleadoId, cantidad, unidad:'kg'}]` tras tocar «kg».
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(planta): clasificación por participación y teclado de cantidad`.

### Task 7: Tablet — sumarse, salir, finalizar en equipo

**Files:**
- Modify: `src/planta/MisTareas.tsx`, `src/planta/TarjetaTarea.tsx`, `src/planta/PlantaApp.tsx`, `src/planta/planta.css`, `src/planta/tareas.test.tsx`, `src/planta/PlantaApp.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`ejecutarAccion` con `cantidades`), Task 6.
- Produces: `PlantaApp` despacha `accionar(t: Tarea, a: Accion, cantidades?: Cantidad[])`.

- [ ] **Step 1: Tests:** secciones «Mías», «En curso — sumarme», «Disponibles» con sus tarjetas; «Con: Ana» en una tarea compartida; Sumarme → confirmación → `ejecutarAccion({accion:'sumarse'})`; Salir en envasado abre `DeclararCantidad` con un campo y manda `cantidades`; Salir en fabricación muestra «Tus MP cargadas quedan registradas a tu nombre» y manda sin cantidades; siendo la última, Salir deshabilitado con «Sos la última: pausá o finalizá»; Finalizar envasado con 2 operarias abre 2 campos con sus nombres; error `ULTIMA_OPERARIA` del servidor muestra su texto.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4:** `npx vitest run src/planta` PASS.
- [ ] **Step 5: Commit** `feat(planta): sumarse, salir y finalizar con varias operarias`.

### Task 8: Tablet — vencimiento, etiqueta y quién marcó cada MP

**Files:**
- Modify: `src/planta/TarjetaTarea.tsx`, `src/planta/ChecklistMp.tsx`, `src/planta/PlantaApp.tsx`, `src/planta/tareas.test.tsx`, `src/planta/checklistMp.test.tsx`

**Interfaces:**
- Consumes: `setVencimiento` (Task 5), `Tarea.vencimiento`, `Tarea.etiqueta`.

- [ ] **Step 1: Tests:** tarjeta de fabricación mía con vencimiento muestra «Vence: 12/05/2027» y botón editar; sin vencimiento muestra «Cargar vencimiento»; elegir fecha llama `setVencimiento({fabricacionId, fecha:'2027-05-12', empleadoId})`; envasado muestra «Etiqueta: Etiqueta-test» o «Sin etiquetar»; renglón de MP marcado muestra el nombre de quien lo marcó; una segunda operaria de la fabricación puede marcar.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar** (fecha con `<input type="date">`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(planta): vencimiento desde la tablet, etiqueta y autor de cada MP`.

### Task 9: Panel — catálogo de etiquetas y Sí/No en Nueva orden

**Files:**
- Modify: `src/panel/config/datosCatalogo.ts` (`TablaCatalogo` + `'etiquetas'`), `src/panel/config/Configuracion.tsx` (pestaña «Etiquetas», campo `nombre`), `src/panel/config/catalogos.test.tsx`
- Modify: `src/domain/ordenes.ts` (`NuevoEnvasado`/`NuevoFraccionado`: quitar `etiquetado`, agregar `etiquetar: boolean; etiqueta_id: string | null`; validación «Elegí una etiqueta.» si `etiquetar && !etiqueta_id`), `src/domain/ordenes.test.ts`
- Modify: `src/panel/datosOrden.ts` (cargar etiquetas activas; insert manda solo `etiqueta_id`), `src/panel/NuevaOrden.tsx`, `src/panel/nuevaOrden.test.tsx`

- [ ] **Step 1: Tests:** pestaña Etiquetas lista/alta/desactivar; Nueva orden envasado: radio «No» por defecto sin desplegable; «Sí» muestra desplegable solo con activas; guardar con Sí sin elegir → «Elegí una etiqueta.»; con una elegida inserta `etiqueta_id`; `ETIQUETA_INACTIVA` del servidor se muestra.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(panel): catálogo de etiquetas y etiquetado Sí/No`.

### Task 10: Panel — detalle de operarias, corregir, totales; Flujo y Monitor

**Files:**
- Create: `src/panel/OperariasOrden.tsx`, `src/panel/operariasOrden.test.tsx`
- Create: `src/domain/participaciones.ts`, `src/domain/participaciones.test.ts`
- Modify: `src/panel/DetalleTanque.tsx` (sección por la fabricación y por cada envasado), `src/panel/TarjetaFlujo.tsx` (nombres desde `fila.operarias`, botón «Operarias» que abre `OperariasOrden` en diálogo), `src/panel/flujo.test.tsx`, `src/panel/datosTanque.ts` (`cargarParticipaciones(entidad, id)` desde `participaciones` + nombres de `v_operarias`; `cargarMpPorOperaria(fabId)`), componentes de `src/panel/monitor` que muestren operarias

**Interfaces:**
- Produces: `cantidadEfectiva(p: Participacion): number | null` (corregida ?? declarada); `totalDeclarado(ps: Participacion[]): { total: number; unidad: Unidad | null; faltan: number }`; `esperadoEnvasado(cantidad: number, litrosPresentacion: number): number`; `<OperariasOrden entidad id presentacionLitros? cantidad? />`.

- [ ] **Step 1: Tests:** `cantidadEfectiva` prefiere corregida; `totalDeclarado` suma efectivas y cuenta `faltan` (cerradas con null); tabla con «sigue» para abiertas; «Corregir» → campo → `corregirCantidad` y muestra «~~120 L~~ → 115 L · corregido por …»; cerrada con null muestra «Falta declarar» y botón «Cargar»; total 100 L vs esperado 100 × 1 L sin ámbar, 90 L con ámbar; fabricación muestra columna «MP cargadas»; orden vieja sin participaciones muestra `operaria_1`/`operaria_2` y no «Falta declarar» (Review Focus 5); tarjeta de flujo con 3 operarias muestra las 3.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4:** `npx vitest run src/panel src/domain` PASS.
- [ ] **Step 5: Commit** `feat(panel): operarias por orden con corrección y totales`.

### Task 11: Historial

**Files:**
- Modify: `src/domain/historial.ts` (`filtrarHistorial` busca en nombres de `participaciones` además de `operaria_1/2_nombre`), `src/domain/historial.test.ts`, `src/panel/historial/Historial.tsx` (columna «Operaria(s)» desde participaciones con cantidad efectiva; fallback a `operaria_1/2_nombre`), `src/panel/historial/historial.test.tsx`, `src/domain/csv.ts` (una fila por participación en la exportación) + `csv.test.ts`, `src/panel/datosTanque.ts` + recorrido en `DetalleTanque.tsx` (textos de eventos nuevos)

- [ ] **Step 1: Tests:** filtro «Ana» encuentra una orden donde Ana solo se sumó; columna muestra «Marta 115 L · Ana 80 L»; fila vieja muestra los nombres de siempre; CSV con 2 participaciones da 2 filas; recorrido: «Ana se sumó», «Marta salió (120 L)», «Juana corrigió a Marta: 120 → 115 L», «Ana cambió el vencimiento a 12/05/2027».
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(historial): participación de cada operaria`.

### Task 12: DEMO y e2e

**Files:**
- Modify: `src/demo/simulador.ts` (estado de participaciones y etiquetas; `accion` con sumarse/salir/cantidades y los mismos códigos de error; `corregir_cantidad`, `set_vencimiento`; las operarias simuladas a veces se suman y salen declarando), `src/demo/fetchDemo.ts` (rutas de las RPC nuevas y tablas `etiquetas`/`participaciones`), `src/demo/catalogo.ts` (2 etiquetas inventadas), `src/demo/simulador.test.ts`, `src/demo/fetchDemo.test.ts`
- Modify: `e2e/mocks.ts`, `e2e/planta.spec.ts`, `e2e/demo.spec.ts`, `e2e/nueva-orden.spec.ts`

- [ ] **Step 1: Tests:** simulador: sumarse/salir/finalizar replican los errores de Task 2; fetchDemo enruta `rpc/corregir_cantidad` y `rpc/set_vencimiento`; e2e planta: sumarse y salir declarando; e2e demo: aparece una orden con 2 operarias; e2e nueva-orden: etiquetado Sí con etiqueta.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4:** `npx vitest run` y `npm run e2e` PASS.
- [ ] **Step 5: Commit** `feat(demo): varias operarias, etiquetas y vencimiento en el simulador`.

### Task 13: Verificación final y publicación (con OK del usuario)

- [ ] **Step 1:** `npm run typecheck && npm run lint && npx vitest run && npm run e2e && npm run build` → todo verde. Todos los `supabase/tests/*.test.sql` → PASS.
- [ ] **Step 2:** Pedir OK → `apply_migration` de 013 (`produccion_sin_pin`). Verificar `prosrc` de `accion` sin `verificar_pin`.
- [ ] **Step 3:** Pedir OK → `apply_migration` de 014 (`produccion_operarias_multiples`). Verificar con `list_migrations` y un `select` a `v_tareas.operarias`.
- [ ] **Step 4:** `git push` + `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main` (cuenta `alechiesasubatir-bit`); esperar el run en verde.
- [ ] **Step 5:** Actualizar la memoria (`prodcontrol-infra.md`: 013 y 014 aplicadas).
