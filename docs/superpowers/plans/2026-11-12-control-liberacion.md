# Control para liberación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estado `en_control` entre fabricar y envasar, con controles (pH, densidad, perfume, visual) aprobados o rechazados por una encargada desde el panel o la tablet.

**Architecture:** Migración 015 agrega el estado, la tabla `controles` y las RPC `registrar_control` / `listar_liberadoras`; `accion('finalizar')` de fabricación pasa a `en_control`. Las vistas exponen el estado y los intentos. Un formulario compartido (`FormControl`) se usa en la tablet y el panel.

**Tech Stack:** Postgres/Supabase (plpgsql, pgTAP), React 19 + TS, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-control-liberacion-design.md`

## Global Constraints

- Migración nueva: `supabase/migrations/20261112000015_produccion_control_liberacion.sql`. NO aplicar a producción (`iyqufnmpjkyfzspujwyf`) sin OK del usuario.
- Tests SQL: el implementador NO llama `execute_sql`; genera un `all.sql` (`begin;` + 015 + `_fixtures.sql` + todos los `supabase/tests/*.test.sql` con savepoints, devuelve `archivo | ok | fallas`, termina en `rollback;`) en el scratchpad con el generador existente y avisa; el controlador lo corre. 013 y 014 ya están aplicadas en producción: no se incluyen.
- RPC devuelven `{ok:false, codigo, detalle}` (internos con SQLSTATE `PC001`). Códigos usados: `NO_AUTORIZADO`, `NO_ENCONTRADO`, `TRANSICION_INVALIDA`, `DATOS_INVALIDOS` (todos ya existen en `src/lib/errores.ts`).
- Columnas nuevas de vistas siempre al final. `src/lib/database.types.ts` se edita a mano.
- Repo público: datos inventados. Estilo: comillas simples, sin punto y coma, español rioplatense.
- Textos exactos: grupo «En control»; botón «Controlar»; paso «¿Quién controla?»; chip «En control»; confirmaciones «¿Aprobar el control? El tanque queda listo para envasar.», «Hay puntos No OK. ¿Aprobar igual?», «La fabricación vuelve a fabricando.»; rechazo en tarjeta «Rechazado: <motivo>»; sección «Control»; historial «Aprobado (<nombre>, <n>.º intento)».
- Polvo (`producto_tipo = 'polvo'`): sin pH ni densidad.
- Vitest: `npx vitest run src --exclude ".claude/**"`. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Lugares que listan estados "abiertos" de fabricación (índice único de tanque, `crear_fabricacion_formula` lote duplicado, `ABIERTA` del historial, NuevaOrden, v_tanque_estado) deben incluir `en_control`; si no, se podría crear otra orden en un tanque en control. Test en Tasks 1 y 4.
2. KPIs: una fabricación en `en_control` ya está fabricada (cuenta como hecha como `para_envasar`). Test en Task 4.
3. Doble control simultáneo (panel y tablet a la vez) → la fila se bloquea; el segundo recibe `TRANSICION_INVALIDA`. Test en Task 2.
4. Rechazada y vuelta a fabricando sin participaciones abiertas → aparece en «En curso — sumarme» y cualquier operaria puede finalizarla (regla de 014). Test en Task 6.
5. Polvo: el formulario no muestra pH/densidad y la RPC no los exige ni los guarda. Tests en Tasks 2 y 5.

---

### Task 1: Esquema y estado `en_control`

**Files:** Create la migración 015 (sección 1); Create `supabase/tests/control.test.sql`; Modify tests SQL que esperan `para_envasar` tras `finalizar` de fabricación (rpc, tablet, participaciones, formula_mp).

**Produces:** `fabricaciones.estado` admite `en_control`; `fabricaciones_tanque_abierta_uk` recreado incluyendo `en_control`; `eventos.accion` admite `aprobar`, `rechazar`; tabla `produccion.controles` (columnas del spec, `unique (fabricacion_id, intento)`, RLS lectura panel/planta, sin grants de escritura, en `supabase_realtime`); `accion()` (copiar la de 014) con `finalizar` fabricando→`en_control` y `cancelar` válido en `en_control`; cualquier otro objeto que liste estados abiertos (p. ej. `crear_fabricacion_formula` en 011) actualizado.

- [ ] Tests: finalizar fabricación → `en_control`; segunda orden en tanque `en_control` → error de índice (`TANQUE_OCUPADO` vía RPC/insert); envasado sobre fabricación `en_control` → `TANQUE_NO_LISTO`; cancelar desde panel en `en_control` → `cancelada`; RLS de controles (planta no inserta).
- [ ] Generar all.sql → controlador corre → FAIL. Implementar. → PASS (todos los archivos). Commit `feat(db): estado en_control y tabla controles (015)`.

### Task 2: RPC `registrar_control` y `listar_liberadoras`

**Produces:** firmas exactas del spec; `registrar_control` devuelve `{ok:true, intento}`; eventos `aprobar`/`rechazar` con `usuario_id` = firmante y `datos {control_id, intento, motivo}`; motivo = comentarios No OK («perfume No OK (…)», «visual No OK (…)») + observaciones, unidos con «; ».

- [ ] Tests: panel aprueba (firma uid, origen panel, → para_envasar, evento); planta aprueba con firmante válido (origen tablet); planta sin firmante / firmante sin rol / inactivo → NO_AUTORIZADO; rechazar → fabricando + evento con motivo; refinalizar + controlar → intento 2; No OK sin comentario, pH 15, densidad 0, pH null en no-polvo → DATOS_INVALIDOS; polvo sin pH/densidad → ok y guarda null aunque vengan; fuera de en_control → TRANSICION_INVALIDA; segundo control tras aprobar → TRANSICION_INVALIDA (Review Focus 3); listar_liberadoras solo activos con admin o rol_produccion panel; planta puede llamarla.
- [ ] FAIL → implementar → PASS. Commit `feat(db): registrar_control y listar_liberadoras`.

### Task 3: Vistas

**Produces:** `v_tanque_estado`, `v_flujo`, `v_tareas` incluyen `en_control`; al final de `v_flujo` y `v_tareas`: `control_intento int`, `control_rechazo text` (motivo del último control si fue rechazado y la fabricación está en fabricando/pausada; null si no); al final de `v_historial`: `controles jsonb` (keys del spec, orden por intento; `'[]'` fuera de fabricación). Partir de las definiciones de 014 (y 012 para v_tanque_estado).

- [ ] Tests: cada vista incluye una fabricación en_control; control_intento = 2 tras un rechazo; control_rechazo con el motivo; v_historial.controles con 2 intentos.
- [ ] FAIL → implementar → PASS. Commit `feat(db): vistas con estado en control y controles`.

### Task 4: Cliente y dominio

**Files:** `src/lib/database.types.ts`, `src/lib/acciones.ts` (+test), `src/domain/{tanque,flujo,kpis,acciones,tareas}.ts` (+tests), `src/panel/historial/Historial.tsx` (ESTADOS/ABIERTA), `src/panel/NuevaOrden.tsx`, `src/domain/control.ts` (+test, nuevo).

**Produces:**
- `registrarControl(p: { fabricacionId; ph: number | null; densidad: number | null; perfumeOk: boolean; perfumeComentario: string; visualOk: boolean; visualComentario: string; observaciones: string; resultado: 'aprobado' | 'rechazado'; firmante?: string }): Promise<Resultado<{ intento: number }>>`
- `listarLiberadoras(): Promise<{ id: string; nombre: string }[]>`
- `EstadoTanque` incluye `'en_control'` (color propio en el mapeo existente); `columnaFlujo` pone `en_control` en la columna de fabricación; KPIs cuentan `en_control` como fabricada; `accionesPosibles('fabricacion','en_control','panel')` = `['cancelar']`, planta `[]`; etiqueta de estado «En control».
- `src/domain/control.ts`: `type FormControl = { ph: string; densidad: string; perfumeOk: boolean | null; perfumeComentario: string; visualOk: boolean | null; visualComentario: string; observaciones: string }`, `validarControl(f: FormControl, esPolvo: boolean): Partial<Record<keyof FormControl, string>>` (mensajes: «Falta el pH.», «El pH va de 0 a 14.», «Falta la densidad.», «La densidad tiene que ser mayor a 0.», «Marcá OK o No OK.», «Explicá qué está mal.»), `hayNoOk(f)`, `motivoRechazo(c)` (mismo formato que el SQL).
- [ ] Tests de cada función/regla anterior. FAIL → implementar → PASS + typecheck/lint. Commit `feat(cliente): estado en control, tipos y llamadas`.

### Task 5: Formulario compartido `FormControl`

**Files:** Create `src/ui/FormularioControl.tsx` (+ test), estilos en el CSS compartido de `src/ui` (o planta.css/panel.css si no hay).

**Produces:** `<FormularioControl esPolvo={boolean} intento={number} onAprobar={(f: FormControl) => Promise<Resultado>} onRechazar={(f) => Promise<Resultado>} onCancelar={() => void} />` — campos del spec (pH/densidad con `parsearCantidad`-style decimal coma, ocultos si polvo), OK/No OK con `aria-pressed`, comentario requerido si No OK, Observaciones; Aprobar/Rechazar con confirmación (textos exactos de Global Constraints) y error del servidor en `role="alert"`.

- [ ] Tests: polvo oculta pH/densidad; validaciones bloquean; Aprobar con No OK muestra «Hay puntos No OK. ¿Aprobar igual?»; Rechazar confirma con su texto; pasa los valores parseados (coma decimal). FAIL → implementar → PASS. Commit `feat(ui): formulario de control para liberación`.

### Task 6: Tablet

**Files:** `src/planta/MisTareas.tsx`, `TarjetaTarea.tsx`, `PlantaApp.tsx`, Create `src/planta/QuienControla.tsx`, tests.

- [ ] Tests: grupo «En control» con «Intento 2» y botón Controlar; flujo ¿Quién controla? (lista de `listarLiberadoras`) → FormularioControl → `registrarControl({ firmante })`; fabricación rechazada muestra «Rechazado: <motivo>» en «En curso — sumarme» y se puede sumar (Review Focus 4). FAIL → implementar → PASS. Commit `feat(planta): control para liberación desde la tablet`.

### Task 7: Panel

**Files:** `src/panel/TarjetaFlujo.tsx`, `Flujo.tsx`, `monitor/Monitor.tsx`, `Tanques.tsx`/`CarruselTanques.tsx` (color), `DetalleTanque.tsx`, Create `src/panel/ControlesOrden.tsx` (sección «Control», `<details>` plegada), `datosTanque.ts` (`cargarControles(fabId)`), tests. Suscripción realtime a `controles` donde se muestre (Flujo/Tanques/ControlesOrden vía `useCambios`).

- [ ] Tests: chip «En control» + botón Controlar abre FormularioControl en diálogo (portal, Escape) y llama `registrarControl` sin firmante; Monitor solo chip; sección Control lista intentos con resultado, valores, firmante, hora, origen; tanque en control con su color. FAIL → implementar → PASS (+ e2e detalle-tanque entra entero). Commit `feat(panel): control para liberación en el panel`.

### Task 8: Historial

**Files:** `src/domain/historial.ts`, `src/domain/recorrido.ts`, `src/panel/historial/Historial.tsx`, tests.

- [ ] Tests: columna «Control» «Aprobado (María, 2.º intento)» / «—»; CSV agrega pH, Densidad, Perfume, Visual, Liberó, Fecha liberación (vacíos desde la 2.ª fila de la orden); recorrido «María aprobó el control», «María rechazó el control: perfume No OK (muy suave)». FAIL → implementar → PASS. Commit `feat(historial): control para liberación`.

### Task 9: DEMO y e2e

**Files:** `src/demo/{simulador,fetchDemo,catalogo}.ts` (+tests), `e2e/{mocks,planta,demo}.spec.ts`.

- [ ] Simulador: finalizar fabricación → en_control; una «encargada demo» controla tras un rato (aprueba ~85 %, rechaza con motivo inventado el resto); rutas `rpc/registrar_control`, `rpc/listar_liberadoras`, tabla `controles`; vistas con los campos nuevos. e2e: planta controla y aprueba; demo muestra una fabricación «En control». Todo verde (vitest, typecheck, lint, e2e). Commit `feat(demo): control para liberación en el simulador`.

### Task 10: Verificación final y publicación (con OK del usuario)

- [ ] Suites completas verdes; all.sql 0 fallas.
- [ ] OK → `apply_migration` 015; verificar con `list_migrations` y un select a `v_tareas`.
- [ ] Merge a main, push, `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main` (cuenta alechiesasubatir-bit; luego volver a achiesa77-ctrl). Pedir recargar tablets/panel/monitor. Actualizar memoria.
