# Pausa General y Arranque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un botón del panel pausa todas las órdenes en marcha al cerrar el día (cerrando a cada operaria con sus L/kg) y bloquea la planta; otro botón las reanuda al día siguiente con las operarias que elija la encargada.

**Architecture:** Migración 018 agrega `pausas_generales` y `pausa_general_ordenes`, las RPC `pausa_general` / `arranque_general`, el bloqueo de planta en `accion()` / `cargar_mp()` / `cargar_consumible()` y ajusta `revisar_alertas`. Los eventos son los de siempre (`pausar`, `salir`, `reanudar`, `sumarse`) con `datos.pausa_general`, así tiempos e historial funcionan solos. En el front: dominio puro `pausaGeneral.ts`, botón y dos diálogos en el panel, franja + bloqueo en tablet y Monitor, y el simulador de la demo.

**Tech Stack:** Postgres/Supabase (plpgsql, pgTAP), React 19 + TS, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-pausa-general-design.md`

## Global Constraints

- Migración nueva: `supabase/migrations/20261116000018_produccion_pausa_general.sql`. 001–017 ya aplicadas. NO aplicar a producción (`iyqufnmpjkyfzspujwyf`) sin OK del usuario. Publicar: migración → verificar → recién después push/deploy (nunca en paralelo).
- Tests SQL: archivo nuevo `supabase/tests/pausa_general.test.sql` (encabezado y estilo de `participaciones.test.sql`: `_tap`, `plan(n)`, ids fijos `00000000-…`). El implementador NO llama `execute_sql`: genera en el scratchpad un `all.sql` (`begin;` + 018 + `_fixtures.sql` + cada `supabase/tests/*.test.sql` en su savepoint, contador por archivo, devuelve `archivo | ok | fallas`, termina en `rollback;`) y avisa; el controlador lo corre. Si pasa de ~94 KB, partir en 2.
- RPC: `security definer`, `search_path = ''`, errores de negocio `{ok:false, codigo, detalle}` (internos SQLSTATE `PC001`), `revoke … from public, anon` + `grant … to authenticated`. Partir de las definiciones vigentes: `accion()` y `cargar_consumible()` de 017, `cargar_mp()` de 014, `revisar_alertas()` de 016.
- Códigos nuevos (agregar a `CodigoError` y a los mensajes de `src/lib/errores.ts`):
  - `PAUSA_GENERAL` → «La planta está en pausa general desde las {detalle}. La encargada la levanta con Arranque.»
  - `PAUSA_GENERAL_ACTIVA` → «Ya hay una pausa general en curso.»
  - `SIN_PAUSA_GENERAL` → «No hay ninguna pausa general en curso.»
  - `SIN_ORDENES` → «No hay órdenes en marcha para pausar.»
  - `SIN_OPERARIAS` → «Cada orden que se reanuda necesita al menos una operaria ({detalle}).»
- Eventos de la pausa general: `datos.pausa_general = <pausa_id>`; `empleado_id` = la operaria (en `salir`/`sumarse`), `usuario_id = auth.uid()`.
- Textos exactos: botón «Pausa General» / «Arranque»; franja «Planta en pausa general desde HH:MM»; tablet agrega «— la encargada la levanta con Arranque»; diálogo vacío «No hay órdenes en marcha»; orden finalizada/cancelada en la noche «cerrada en la noche»; historial «Pausa general» y «Arranque».
- `src/lib/database.types.ts` se edita a mano. Estilo: comillas simples, sin punto y coma, español rioplatense.
- Vitest: `npx vitest run src --exclude ".claude/**"`. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rama `feat/pausa-general`.

## Review Focus

1. **La encargada finaliza o cancela una orden durante la noche** y después hace el Arranque con esa orden marcada (pantalla vieja abierta) → `TRANSICION_INVALIDA` con el nombre de la orden, sin aplicar nada. El diálogo la muestra como «cerrada en la noche». Tests en las Tasks 2 y 5.
2. **Una operaria marcada en dos envasados en el Arranque**, o en uno de la lista y en otro envasado `activo` que la encargada reanudó a mano en la noche → `OPERARIA_OCUPADA`. El front lo valida antes de enviar. Tests en las Tasks 2 y 4.
3. **Dos pestañas del panel aprietan Pausa General a la vez** → la segunda recibe `PAUSA_GENERAL_ACTIVA` (índice único + lock), nunca dos pausas abiertas. Test en la Task 1.
4. **Orden en curso sin participaciones abiertas** (iniciada desde el panel o legado) → se pausa igual, `operarias = '{}'`, no exige cantidad; en el Arranque sale sin operarias marcadas y obliga a elegir una. Tests en las Tasks 1 y 4.
5. **La tablet tiene el teclado de cantidad abierto cuando cae la pausa** → la respuesta `PAUSA_GENERAL` se muestra con el mensaje amable y la tarjeta queda bloqueada por realtime. Test en la Task 6.

---

### Task 1: Esquema y `pausa_general()`

**Files:**
- Create: `supabase/migrations/20261116000018_produccion_pausa_general.sql` (sección 1)
- Create: `supabase/tests/pausa_general.test.sql`

**Produces:**
- Tablas `produccion.pausas_generales` y `produccion.pausa_general_ordenes` (columnas, índice único parcial `((true)) where fin is null`, PK y RLS según la spec §1). Lectura de `pausas_generales`: `es_panel() or es_planta()`; de `pausa_general_ordenes`: `es_panel()`. Sin grants de escritura. `pausas_generales` va a `supabase_realtime`.
- `produccion.pausa_general(p_cantidades jsonb) returns jsonb` → `{ok:true, pausa_id, ordenes:int}`. Reglas, orden de bloqueo y eventos según la spec §1. `CANTIDAD_REQUERIDA` con `detalle` = `'<operaria> en <producto> <presentación>'`.
- `produccion._pausa_general_abierta() returns produccion.pausas_generales` (helper `stable`; fila o null), usado en las Tasks 2 y 3.

- [ ] **Step 1: Tests (fallan).** Escenario: fabricación `fabricando` con E1; envasado `activo` con E1+E2; fraccionado `pausado` con E2; envasado `activo` sin participaciones; envasado en `cola` (no se toca).
  - Desde el panel con cantidades completas → `ok`; las 3 en curso quedan pausadas; el fraccionado sigue `pausado`; el de cola sigue `cola`.
  - `eventos`: un `pausar` por cada orden que estaba en curso (3) y ninguno para el fraccionado; un `salir` por participación (4), todos con `datos->>'pausa_general' = pausa_id`; los `salir` de envasado/fraccionado con `cantidad` y `unidad`.
  - Las participaciones quedan cerradas con su cantidad; las de fabricación con `cantidad null`.
  - `pausa_general_ordenes`: 4 filas; `estaba` = `en_curso` ×3 y `pausada` ×1; `operarias` = `{E1}`, `{E1,E2}`, `{E2}` y `{}`.
  - Falta la cantidad de E2 en el envasado → `{ok:false, codigo:'CANTIDAD_REQUERIDA'}`; después no hay `pausas_generales` ni cambios de estado.
  - Segunda llamada con una pausa abierta → `PAUSA_GENERAL_ACTIVA`.
  - Con todo terminado → `SIN_ORDENES`.
  - Desde planta → `NO_AUTORIZADO`.
  - Insertar directo en `pausas_generales` desde el panel → error 42501.
- [ ] **Step 2:** Generar `all.sql` → el controlador lo corre → FAIL.
- [ ] **Step 3:** Implementar la sección 1 de la migración.
- [ ] **Step 4:** `all.sql` → PASS (todos los archivos).
- [ ] **Step 5:** Commit `feat(db): pausa general (018)`.

### Task 2: `arranque_general()` y bloqueo de planta

**Files:** Modify la migración 018 (sección 2); Modify `supabase/tests/pausa_general.test.sql`.

**Consumes:** `_pausa_general_abierta()` (Task 1).

**Produces:**
- `produccion.arranque_general(p_ordenes jsonb) returns jsonb` → `{ok:true, reanudadas:int}`. `p_ordenes = [{entidad, entidad_id, empleados:[uuid]}]`. Validaciones, eventos y cierre según la spec §1. `OPERARIA_OCUPADA` con el mismo `detalle` que `accion()` (producto + presentación); para el chequeo entre órdenes de la lista, el `detalle` es el otro envasado de la lista. `SIN_OPERARIAS` y `TRANSICION_INVALIDA` con `detalle` = `'<producto> <tanque o presentación>'`.
- `accion()`, `cargar_mp()` y `cargar_consumible()`: si `not es_panel()` y `_pausa_general_abierta()` no es null → `{ok:false, codigo:'PAUSA_GENERAL', detalle: to_char(inicio at time zone 'America/Montevideo','HH24:MI')}` antes de cualquier otra regla de negocio (después del chequeo de rol). Mismas firmas y grants.

- [ ] **Step 1: Tests (fallan)**, sobre el escenario de la Task 1 ya pausado.
  - Planta `accion(… 'reanudar' …)` → `PAUSA_GENERAL` con `detalle` `HH:MI`.
  - Planta `cargar_mp` → `PAUSA_GENERAL`; planta `cargar_consumible` → `PAUSA_GENERAL`.
  - Panel `accion(… 'finalizar' …)` sobre una orden → funciona.
  - Arranque con la fabricación (E2) y el envasado (E1) → `ok`, `reanudadas = 2`; quedan `fabricando`/`activo` con participaciones abiertas nuevas; eventos `reanudar` y `sumarse` con `pausa_general`; el fraccionado sigue `pausado`; la pausa queda con `fin` y `terminada_por`.
  - En una pausa nueva:
    - orden con `empleados: []` → `SIN_OPERARIAS`;
    - E1 en dos envasados de la lista → `OPERARIA_OCUPADA`;
    - E3 (baja) → `OPERARIA_INACTIVA`;
    - orden cancelada por el panel durante la pausa → `TRANSICION_INVALIDA`, y la pausa sigue abierta;
    - orden que no está en `pausa_general_ordenes` → `NO_ENCONTRADO`;
    - lista vacía → `ok`, cierra la pausa.
  - Sin pausa → `SIN_PAUSA_GENERAL`. Desde planta → `NO_AUTORIZADO`.
- [ ] **Step 2:** `all.sql` → FAIL. **Step 3:** Implementar. **Step 4:** `all.sql` → PASS (incluidos `participaciones`, `control` y `envasado_documento`, que ejercitan `accion()`).
- [ ] **Step 5:** Commit `feat(db): arranque general y bloqueo de planta`.

### Task 3: Alertas y tiempos

**Files:** Modify la migración 018 (sección 3: `revisar_alertas`); Modify `supabase/tests/pausa_general.test.sql`.

**Produces:** `revisar_alertas()` según la spec §1, en dos partes:

- Con pausa abierta: hace los `delete` y devuelve 0 sin insertar.
- `exceso_9h` por tiempo efectivo:
  - **Envasado:** `te.min_efectivos > 540` (join a `v_tiempos_efectivos`).
  - **Fabricación:** calcular los minutos con un `lateral`:
    1. desde = `greatest(f.inicio, último rechazar)`;
    2. minutos = `now() - desde`, menos la suma de los tramos `pausar` → (`reanudar`/`finalizar`/`cancelar` siguiente, o `now()`) recortados a `>= desde`;
    3. salta si da `> 540`.

- [ ] **Step 1: Tests (fallan).** Para mover el reloj, insertar los eventos con `at` en el pasado (como postgres).
  - Con pausa abierta y un envasado pausado hace 2 h → `revisar_alertas() = 0` y no hay `pausa_larga`.
  - Fabricación iniciada hace 20 h con una pausa de 14 h (`pausar`/`reanudar`) → sin `exceso_9h`; la misma con una pausa de 2 h → `exceso_9h`.
  - Envasado activo iniciado hace 12 h con 10 h de pausa → sin `exceso_9h`.
  - Fabricación con rechazo hace 10 h y sin pausas → `exceso_9h` (se mantiene la regla de 016).
  - `v_tiempos_efectivos.min_pausa` del envasado ≈ 600.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS (incluido `alerta_control.test.sql`). **Step 5:** Commit `feat(db): alertas sin falsos positivos por pausas`.

### Task 4: Cliente, dominio y errores

**Files:**
- Create: `src/domain/pausaGeneral.ts`, `src/domain/pausaGeneral.test.ts`
- Modify: `src/lib/errores.ts` (+ test), `src/lib/acciones.ts`, `src/lib/database.types.ts`

**Produces:**
- `database.types.ts`: tablas `pausas_generales` y `pausa_general_ordenes`; funciones `pausa_general` y `arranque_general`.
- `acciones.ts`: agregar `'pausa_general' | 'arranque_general'` a `llamar`, y estas dos funciones:
  - `pausaGeneral(cantidades: CantidadOrden[]): Promise<Resultado<{ pausaId: string }>>`
  - `arranqueGeneral(ordenes: OrdenArranque[]): Promise<Resultado>`
- `pausaGeneral.ts`, tipos:
  - `type RefOrden = { entidad: Entidad; id: string }`
  - `type CantidadOrden = RefOrden & Cantidad`
  - `type OrdenArranque = RefOrden & { empleados: string[] }`
  - `type PausaAbierta = { id: string; inicio: string }`
- `pausaGeneral.ts`, funciones:
  - `ordenesEnMarcha(flujo: FilaFlujo[]): FilaFlujo[]`: estados `fabricando`/`pausada`/`activo`/`pausado`, ordenadas por entidad (fabricación, envasado, fraccionado) y producto.
  - `pideCantidad(o: FilaFlujo): boolean`: solo envasado y fraccionado.
  - `unidadPorDefecto(o: FilaFlujo): Unidad`: `kg` si `producto_tipo === 'polvo'`, si no `L`.
  - `faltanCantidades(ordenes: FilaFlujo[], cantidades: CantidadOrden[]): RefOrden[]`
  - `armarArranque(filas: { entidad; entidad_id; estaba; operarias: string[] }[], flujo: FilaFlujo[]): EstadoArranque[]`
    - `EstadoArranque = { ref: RefOrden; orden: FilaFlujo | null; cerrada: boolean; reanudar: boolean; empleados: string[] }`
    - `cerrada` = la orden ya no está pausada; `reanudar` = `estaba === 'en_curso' && !cerrada`.
  - `erroresArranque(e: EstadoArranque[]): Record<string, string>`, con clave `` `${entidad}:${id}` `` y estos mensajes:
    - «Elegí al menos una operaria.»
    - «<nombre> ya está en otro envasado.» (recibe un mapa de nombres como segundo parámetro)

- [ ] **Step 1: Tests (fallan).**
  - `ordenesEnMarcha` excluye `cola`, `en_control`, `para_envasar` y `finalizada`.
  - `unidadPorDefecto` devuelve kg para polvo.
  - `faltanCantidades` detecta la operaria sin cantidad en un envasado e ignora las fabricaciones.
  - `armarArranque`: `pausada` → `reanudar` false; orden finalizada → `cerrada`; `operarias` vacías → `empleados` vacío.
  - `erroresArranque`: orden marcada sin operarias, y misma operaria en dos envasados (no aplica a fabricación ni a fraccionado).
  - `mensajeError({codigo:'PAUSA_GENERAL', detalle:'18:05'})` contiene «18:05».
  - `pausaGeneral` manda `p_cantidades` con `entidad`, `entidad_id`, `empleado_id`, `cantidad` y `unidad` (mock de `db.rpc`, como en `acciones.test.ts`).
- [ ] **Step 2:** `npx vitest run src/domain/pausaGeneral.test.ts src/lib` → FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit `feat: dominio y cliente de pausa general`.

### Task 5: Panel — botón y diálogos

**Files:**
- Create: `src/panel/PausaGeneral.tsx` (botón + diálogos), `src/panel/datosPausaGeneral.ts`, `src/panel/pausaGeneral.test.tsx`
- Modify: `src/panel/PanelApp.tsx` (botón a la derecha del `encabezado` + franja), `src/panel/panel.css`

**Consumes:** todo lo de la Task 4.

**Produces:**
- `datosPausaGeneral.ts`:
  - `cargarPausaAbierta(): Promise<PausaAbierta | null>`
  - `cargarOrdenesPausa(pausaId: string)`: filas de `pausa_general_ordenes`
- `usePausaGeneral(): PausaAbierta | null`: con `useRealtime` sobre `pausas_generales`; lo usan las Tasks 6 y 8.
- `<BotonPausaGeneral />`:
  - Sin pausa: «Pausa General»; abre `DialogoPausa`, que lee `v_flujo` (`cargarFlujo`) y `ordenesEnMarcha`.
  - Con pausa: «Arranque» + «en pausa desde HH:MM»; abre `DialogoArranque`.
- `<FranjaPausa pausa />`: «Planta en pausa general desde HH:MM».

`DialogoPausa`:
- Grupos Fabricación / Envasado / Fraccionado.
- En envasado y fraccionado, un input numérico por operaria, más un selector L/kg por orden con `unidadPorDefecto`.
- Confirmar se deshabilita mientras falten cantidades o mientras se envía.
- El error del servidor se muestra con `mensajeError`.
- Con lista vacía: «No hay órdenes en marcha» y confirmar deshabilitado.

`DialogoArranque`:
- Por orden: casilla «Reanudar»; casillas de operarias prellenadas; `<select>` «Sumar operaria» con `v_operarias`.
- Las órdenes `cerrada` aparecen con «cerrada en la noche» y sin controles.
- Muestra los errores de `erroresArranque` y confirma con las que tienen `reanudar`.

- [ ] **Step 1: Tests (fallan)**, en `pausaGeneral.test.tsx` con mocks como `controlesOrden.test.tsx`.
  - El botón dice «Pausa General» sin pausa y «Arranque» con pausa.
  - El diálogo de pausa lista las órdenes, exige las cantidades (confirmar deshabilitado) y llama `pausaGeneral` con lo tipeado.
  - Un producto polvo arranca en kg.
  - Sin órdenes muestra «No hay órdenes en marcha».
  - Arranque: prellenado; destildar a todas las operarias de una orden marcada muestra «Elegí al menos una operaria.»; una orden cerrada muestra «cerrada en la noche»; confirmar llama `arranqueGeneral` solo con las marcadas.
  - `PanelApp` muestra la franja con pausa abierta.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (botón grande, color de acento para «Arranque»; clases nuevas en `panel.css`, sin `transition: all`). **Step 4:** PASS + `npx tsc -b`. **Step 5:** Commit `feat(panel): botón Pausa General y Arranque`.

### Task 6: Tablet y Monitor

**Files:** Modify `src/planta/PlantaApp.tsx`, `src/planta/TarjetaTarea.tsx` (y/o `MisTareas.tsx`, `ChecklistMp.tsx`, `ChecklistConsumibles.tsx`: prop `bloqueada`), `src/panel/monitor/Monitor.tsx`; tests en `src/planta/planta.test.tsx` y `src/panel/monitor/monitor.test.tsx`.

**Consumes:** `usePausaGeneral`, `FranjaPausa` (Task 5).

- [ ] **Step 1: Tests (fallan).**
  - Con pausa abierta, la tablet muestra «Planta en pausa general desde HH:MM — la encargada la levanta con Arranque», y los botones de acción y las casillas de MP y consumibles quedan `disabled`.
  - Una acción que vuelve `PAUSA_GENERAL` muestra el mensaje de `errores.ts`.
  - El Monitor muestra la franja.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit `feat(planta): bloqueo durante la pausa general`.

### Task 7: Historial

**Files:** Modify `src/domain/recorrido.ts` (+ su test).

**Produces:** en `textoEventoOperaria`, cuando `datos.pausa_general` existe:
- `pausar` → «Pausa general»
- `reanudar` → «Arranque»
- `salir` → «<quien> salió por la pausa general (<cant>)»
- `sumarse` → «<quien> se sumó en el arranque»

- [ ] Test de los cuatro textos (falla) → implementar → PASS → commit `feat(historial): eventos de pausa general`.

### Task 8: DEMO y e2e

**Files:**
- Modify: `src/demo/simulador.ts` (+ `simulador.test.ts`), `src/demo/fetchDemo.ts` (+ test), `e2e/demo.spec.ts`

**Produces:**
- `Simulador`:
  - `pausaGeneral(cantidades: Fila[]): { ok: true; pausa_id: string } | Rechazo`
  - `arranqueGeneral(ordenes: Fila[]): { ok: true; reanudadas: number } | Rechazo`
  - Mismas reglas y códigos que las RPC. `consultar('pausas_generales')` y `consultar('pausa_general_ordenes')` devuelven sus filas.
  - Con pausa abierta, `accion()` con `empleadoId` (planta) devuelve `PAUSA_GENERAL`.
  - El modo autónomo no actúa mientras hay pausa.
- `fetchDemo.ts`: rutas `rpc/pausa_general` y `rpc/arranque_general`.

- [ ] **Step 1: Tests (fallan).**
  - Simulador: pausa → órdenes pausadas, participaciones cerradas con cantidades, planta bloqueada; `CANTIDAD_REQUERIDA`, `PAUSA_GENERAL_ACTIVA`, arranque y `SIN_OPERARIAS`.
  - fetchDemo enruta las dos RPC.
  - e2e de demo: Pausa General → franja visible → Arranque → franja oculta.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `npx vitest run src --exclude ".claude/**"` y `npx playwright test e2e/demo.spec.ts` → PASS. **Step 5:** Commit `feat(demo): pausa general en el simulador`.

### Task 9: Verificación final y publicación (con OK del usuario)

- [ ] `npx tsc -b`, `npx vitest run src --exclude ".claude/**"`, `npx playwright test`, `npm run build` → todo verde.
- [ ] `all.sql` completo (todos los tests SQL con 018) → todos `ok`.
- [ ] Revisión final de la rama (requesting-code-review).
- [ ] Pedir OK al usuario → `apply_migration` 018 en `iyqufnmpjkyfzspujwyf` (avisar antes: la confirmación del conector vence en 2 min) → verificar en la base (`prosrc` de `accion` contiene `PAUSA_GENERAL`; existen las tablas y la publicación realtime).
- [ ] Recién después: merge a main (squash), push, `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main` con la cuenta alechiesasubatir-bit; verificar que el deploy termine.
