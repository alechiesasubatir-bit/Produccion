# Subir PDF de fórmula + checklist de MP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear órdenes de fabricación subiendo el PDF «Movimientos de Produccion» (una o varias fórmulas) y obligar a la operaria a completar lote + pesado de cada MP antes de finalizar.

**Architecture:** El PDF se lee en el navegador con `pdfjs-dist` → fragmentos `{str,x,y,pagina}` → función pura `leerFormulas()` que arma las fórmulas. El panel crea cada fabricación con sus MP en una RPC atómica. La tablet carga lote/pesado con otra RPC (PIN, mismo patrón que `accion()`), y `accion('finalizar')` rechaza si falta alguna MP. Se elimina el escaneo con IA.

**Tech Stack:** React 19 + Vite + TS, Vitest + Testing Library, Playwright, Supabase (Postgres, esquema `produccion`, pgTAP vía `execute_sql`), `pdfjs-dist`.

**Spec:** `docs/superpowers/specs/2026-11-06-pdf-formula-y-checklist-mp-design.md`

## Global Constraints

- Números del PDF: coma = miles, punto = decimal (`1,000.000` → 1000, `(0.300)` → 0.3). Nunca ×1000. Usar `aNumero()` de `src/domain/escaneo.ts`.
- Las RPC no lanzan errores de negocio: devuelven `{ok:false, codigo, detalle}` (códigos en MAYÚSCULAS, como `PIN_INCORRECTO`).
- Migración nueva `supabase/migrations/20261106000011_produccion_formula_mp.sql`; se aplica a producción (proyecto `iyqufnmpjkyfzspujwyf`) **solo con OK explícito del usuario**.
- `src/lib/database.types.ts` se edita a mano (el generador solo emite `public`).
- Textos de UI en español rioplatense (vos), como el resto de la app.
- El PDF nunca sale del navegador.
- Fabricación manual (sin PDF) sigue funcionando: sin MP, no bloquea finalizar, vencimiento opcional.
- Publicar (push + `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main` con la cuenta alechiesasubatir-bit) solo con OK del usuario.

## Review Focus

- **Mismo PDF subido dos veces** → la segunda vez cada fórmula avisa «Ya existe una fabricación con el lote 17702» y no se crea. (Task 2 pgTAP + Task 4 test.)
- **Producto con código ya asignado a otro producto** (F8 matcheado a mano con un producto distinto del que ya tiene F8) → la orden se crea igual y el código no se pisa. (Task 2 pgTAP.)
- **Operaria que no es la asignada intenta cargar MP** (otra operaria en la misma tablet) → `NO_AUTORIZADO`, no se guarda. (Task 2 pgTAP.)
- **Lote de MP con espacios / vacío** → se guarda recortado; vacío cuenta como incompleto. (Task 2 pgTAP + Task 5 test.)
- **PDF con varias páginas, una sin formato** (p. ej. una carátula) → se leen las fórmulas válidas y la página sin formato se ignora; si ninguna es válida, error. (Task 1 test.)

---

### Task 1: Lectura del PDF (dominio + extractor)

**Files:**
- Create: `src/domain/formulaPdf.ts`, `src/domain/formulaPdf.test.ts`, `src/domain/__fixtures__/bactipro.json`, `src/panel/leerPdf.ts`, `scripts/fragmentos-pdf.mjs`, `e2e/fixtures/BACTIPRO.pdf` (copia de `C:\Users\alech\Downloads\BACTIPRO.pdf`)
- Modify: `package.json` (dep `pdfjs-dist`)

**Interfaces:**
- Produces:
  - `type Fragmento = { str: string; x: number; y: number; pagina: number }` (x,y = `transform[4]`, `transform[5]` de pdf.js; y crece hacia arriba)
  - `type MpFormula = { codigo: string; descripcion: string; cantidad: number }`
  - `type Formula = { lote: string; fecha: string /* YYYY-MM-DD */; granel: { codigo: string; nombre: string; litros: number }; mp: MpFormula[] }`
  - `leerFormulas(fr: Fragmento[]): { ok: true; formulas: Formula[] } | { ok: false; error: string }`
  - `extraerFragmentos(archivo: File): Promise<Fragmento[]>` en `src/panel/leerPdf.ts` (import dinámico de `pdfjs-dist`, worker con `pdfjs-dist/build/pdf.worker.min.mjs?url`).

- [ ] **Step 1:** `npm i pdfjs-dist`. Escribir `scripts/fragmentos-pdf.mjs <pdf> <salida.json>` (usa `pdfjs-dist/legacy/build/pdf.mjs` en Node, mismo mapeo que `extraerFragmentos`, descarta `str` vacíos). Generar `src/domain/__fixtures__/bactipro.json` desde el PDF real y copiar el PDF a `e2e/fixtures/`.
- [ ] **Step 2: Tests que fallan** en `formulaPdf.test.ts`:
  - `bactipro.json` → `ok`, 1 fórmula: `lote '17702'`, `fecha '2026-10-21'`, `granel {codigo:'F8', nombre:'Bactipro', litros:1000}`, `mp` = `[{codigo:'900101', cantidad:6.5, descripcion: contiene 'Esencia Floral'}, {'900102', 0.3}, {'900103', 22.5}, {'900104', 970.7}]` en ese orden.
  - Dos fórmulas: el fixture duplicado con `pagina: 2` y lote cambiado a `17703` → 2 fórmulas en orden de página.
  - Página extra sin «LOTE» (fragmentos de texto cualquiera) + bactipro → 1 fórmula.
  - Sin fragmentos / sin «LOTE» → `{ok:false, error:'Este PDF no tiene el formato de Movimientos de Produccion. Cargá la orden a mano.'}`.
  - Bloque sin fila de granel `F\d+` → esa fórmula se descarta; si no queda ninguna, el mismo error.
- [ ] **Step 3: Implementar `leerFormulas`.** Algoritmo (pdftotext muestra que código y descripción NO comparten y exacta, por eso se emparejan por orden):
  1. Separar por página; dentro de la página, un bloque por cada fragmento `/^LOTE/i` (de su y hacia abajo hasta el siguiente LOTE).
  2. Lote: primer fragmento `/^\d+$/` debajo del «LOTE» (y menor, hasta 30 pt) con |x − x_LOTE| < 40. Fecha: primer `/^\d{2}\/\d{2}\/\d{4}$/` del bloque → ISO.
  3. Encabezados del bloque: x de «Cantidad», «Descripci…», «Lote» (el de la tabla, a la derecha de Descripción) y y de «Código». Fin de tabla: y de «Tanque destinado» (o «Observaciones»).
  4. Entre encabezado y fin: **códigos** = fragmentos con x < x_Cantidad − 5 que matchean `/^(F\d+|\d+)$/i`, ordenados por y desc; **renglones** = fragmentos con x ≥ x_Cantidad − 15 y x < x_LoteTabla − 5, agrupados por y (±2), ordenados por y desc; en cada renglón el primero que matchea `/^\(?[\d,]+\.\d+\)?$/` es la cantidad (paréntesis ⇒ MP) y el resto, unido con espacio, la descripción. Emparejar código[i] ↔ renglón[i].
  5. Granel = el par con código `/^F\d+$/i`; nombre = descripción sin `/\s*\(granel\)\s*$/i`. MP = los pares con cantidad entre paréntesis.
- [ ] **Step 4:** `npx vitest run src/domain/formulaPdf.test.ts` → PASS. `npm run typecheck` → sin errores.
- [ ] **Step 5: Commit** — `feat(formula): leer fórmulas del PDF Movimientos de Produccion`

### Task 2: Base de datos (migración 011 + pgTAP)

**Files:**
- Create: `supabase/migrations/20261106000011_produccion_formula_mp.sql`, `supabase/tests/formula_mp.test.sql`

**Interfaces:**
- Produces (SQL):
  - Columnas `fabricaciones.vencimiento date`, `fabricaciones.fecha_formula date`, `productos.codigo text unique`; tabla `fabricacion_mp` exactamente como spec §5.
  - `produccion.crear_fabricacion_formula(p_fab jsonb, p_mp jsonb) returns jsonb` — `p_fab` = `{tanque_id, producto_id, litros, lote, vencimiento, fecha_formula, operaria_id, codigo_producto}`; `p_mp` = `[{codigo, descripcion, cantidad}]`. Solo `es_panel()`. Devuelve `{ok:true, id}` o `{ok:false, codigo}` con `NO_AUTORIZADO`, `LOTE_DUPLICADO` (fabricación no cancelada con ese lote), `TANQUE_OCUPADO` (unique `fabricaciones_tanque_abierta_uk`). Si el producto no tiene `codigo` y ningún otro lo tiene, se le asigna `codigo_producto`; si no, se ignora. `orden` de MP = posición en el array (1..n).
  - `produccion.cargar_mp(p_mp_id uuid, p_lote text, p_pesado boolean, p_empleado_id uuid default null, p_pin text default null) returns jsonb` — panel sin PIN; planta con operaria activa + `_verificar_pin` (idéntico al paso 2 de `accion()`) y debe ser la `operaria_id` de la fabricación (si no: `NO_AUTORIZADO`). Solo si la fabricación está `fabricando`/`pausada` (si no: `TRANSICION_INVALIDA`). Guarda `nullif(trim(p_lote),'')`, `pesado`, `cargado_por = coalesce(p_empleado_id, fabricacion.operaria_id)`, `cargado_at = now()`. `{ok:true}`.
  - `accion()`: redefinir (copiar la versión vigente de `20261021000006_produccion_tablet.sql`) agregando, antes de aplicar `fabricacion`+`finalizar`+`fabricando`: si existe MP con `lote is null or not pesado` → `raise exception using errcode='PC001', message='MP_INCOMPLETA', detail = <n faltantes>::text`.
  - `v_tareas`: redefinir agregando al final `mp_total int`, `mp_completas int` (subconsulta sobre `fabricacion_mp`; 0 para envasado/fraccionado).
  - RLS de `fabricacion_mp`: `select` para `es_panel() or es_planta()`; sin políticas de escritura. `grant execute` de las dos RPC a `authenticated`.

- [ ] **Step 1: Test pgTAP que falla** `formula_mp.test.sql` (mismo arranque que `tablet.test.sql`, sobre `_fixtures.sql`): 
  1. panel crea con 2 MP → `ok`, 2 filas en `fabricacion_mp` con `orden` 1,2; `vencimiento` guardado; producto d1 queda con `codigo='F8'`.
  2. mismo lote otra vez (otro tanque) → `LOTE_DUPLICADO`.
  3. producto con código ya usado por otro → `ok` y el código del primero no cambia.
  4. tablet (a2) llama `crear_fabricacion_formula` → `NO_AUTORIZADO`.
  5. `cargar_mp` con PIN incorrecto → `PIN_INCORRECTO`; con operaria e2 en fabricación de e1 → `NO_AUTORIZADO`; en fabricación `cola` → `TRANSICION_INVALIDA`.
  6. `cargar_mp(' L-55 ', true)` por e1 → `lote = 'L-55'`, `cargado_por = e1`.
  7. `accion(finalizar)` con 1 MP incompleta → `{ok:false, codigo:'MP_INCOMPLETA', detalle:'1'}`; con `lote '   '` cuenta como incompleta; completas → `ok`, estado `para_envasar`.
  8. fabricación sin MP finaliza normal.
  9. `v_tareas` devuelve `mp_total 2, mp_completas 1` tras cargar una.
- [ ] **Step 2:** Correr contra una branch o dentro de `begin … rollback` (convención de la memoria: concatenar `_fixtures.sql` + test con `execute_sql`, leer `_tap`) → falla porque no existen.
- [ ] **Step 3:** Escribir la migración.
- [ ] **Step 4: Pedir OK al usuario** y aplicar con `apply_migration`. Correr `formula_mp.test.sql` y los existentes (`tablet`, `rpc`, `estado`, `panel`, `vistas`) → todos `ok`. `get_advisors` (security) sin avisos nuevos.
- [ ] **Step 5: Commit** — `feat(db): fórmula con MP, checklist y bloqueo de finalizar`

### Task 3: Tipos y llamadas desde el front

**Files:**
- Modify: `src/lib/database.types.ts`, `src/lib/errores.ts`, `src/lib/acciones.ts`, `src/panel/datosOrden.ts`
- Create: `src/lib/datosMp.ts`
- Test: `src/lib/errores.test.ts` (o el existente que cubra `mensajeError`), `src/lib/acciones.test.ts` si existe

**Interfaces:**
- Produces:
  - `CodigoError` += `'MP_INCOMPLETA' | 'LOTE_DUPLICADO'`; textos: `MP_INCOMPLETA: (d) => \`Faltan ${d ?? 'algunas'} MP por completar.\``, `LOTE_DUPLICADO: () => 'Ya existe una fabricación con ese lote.'`
  - `type FilaMp = { id: string; orden: number; codigo: string; descripcion: string; cantidad: number; lote: string | null; pesado: boolean; cargado_por: string | null; cargado_at: string | null }`
  - `cargarMpDe(fabricacionId: string): Promise<FilaMp[]>` (select de `fabricacion_mp` ordenado por `orden`) en `src/lib/datosMp.ts`
  - `guardarMp(p: { id: string; lote: string; pesado: boolean; empleadoId?: string; pin?: string }): Promise<Resultado>` en `src/lib/acciones.ts` (reusar `llamar`, ampliando su unión de nombres)
  - `crearFabricacionFormula(fab: NuevaFabricacionFormula, mp: MpFormula[]): Promise<Resultado<{ id: string }>>` en `datosOrden.ts`, con `type NuevaFabricacionFormula = NuevaFabricacion & { vencimiento: string; fecha_formula: string; codigo_producto: string }` en `src/domain/ordenes.ts`
  - Tipos: `fabricaciones.vencimiento/fecha_formula`, `productos.codigo`, tabla `fabricacion_mp`, `v_tareas.mp_total/mp_completas: number`, `Functions.crear_fabricacion_formula` y `cargar_mp`.
- [ ] **Step 1: Tests que fallan:** `mensajeError({ok:false, codigo:'MP_INCOMPLETA', detalle:'2'}).texto === 'Faltan 2 MP por completar.'`; `LOTE_DUPLICADO` → su texto.
- [ ] **Step 2:** Implementar todo lo de Interfaces. `npm run typecheck` sin errores.
- [ ] **Step 3:** `npx vitest run` → PASS.
- [ ] **Step 4: Commit** — `feat: tipos y llamadas para fórmula y MP`

### Task 4: Panel — Subir PDF de fórmula en Nueva orden

**Files:**
- Create: `src/panel/SubirFormula.tsx`, `src/panel/subirFormula.test.tsx`
- Modify: `src/panel/NuevaOrden.tsx`, `src/panel/panel.css`, `src/domain/ordenes.ts`, `src/domain/ordenes.test.ts`, `src/panel/datosOrden.ts` (`productos` incluye `codigo`; `cargarDatosOrden` trae `lotesAbiertos: string[]` = lotes de fabricaciones no canceladas)
- Delete: `src/panel/EscanearHoja.tsx`, `src/panel/escanear.test.tsx`, `src/panel/imagen.ts` (si `grep` confirma que nadie más lo importa)

**Interfaces:**
- Consumes: `extraerFragmentos`, `leerFormulas`, `Formula` (Task 1); `crearFabricacionFormula`, `NuevaFabricacionFormula` (Task 3); `buscarEnCatalogo` (existente).
- Produces: `<SubirFormula datos={DatosOrden} onCreadas={() => void} />`; `validarFabricacionFormula(d: NuevaFabricacionFormula, ctx: { capacidad: number | null; tanqueLibre: boolean; loteExiste: boolean }): Errores<NuevaFabricacionFormula>` en `ordenes.ts` (los errores de `validarFabricacion` + `vencimiento` requerido y > `fecha_formula` + `lote` duplicado).
- [ ] **Step 1: Tests que fallan:**
  - `validarFabricacionFormula`: sin vencimiento → `'Poné la fecha de vencimiento'`; vencimiento ≤ fecha → `'El vencimiento tiene que ser posterior a la fecha de la fórmula'`; `loteExiste` → `'Ya existe una fabricación con el lote 17702'`.
  - Componente (mockear `extraerFragmentos` para devolver `bactipro.json` y `crearFabricacionFormula`): subir archivo (`getByLabelText('PDF de la fórmula')`) → una tarjeta «Lote 17702 · Bactipro · 1000 L» con la tabla de 4 MP; producto precargado si el catálogo tiene `{nombre:'Bactipro'}` o `{codigo:'F8'}`; si no, `role="status"` «No encontré «Bactipro» en productos»; botón **Crear** deshabilitado hasta tanque libre + vencimiento; al crear, se llama con `mp` de 4 ítems y la tarjeta muestra «Creada»; con dos fórmulas y la segunda devolviendo `LOTE_DUPLICADO`, **Crear todas** deja la primera «Creada» y la segunda con el error y su botón Crear; `leerFormulas` en error → `role="alert"` con el texto de error.
  - `NuevaOrden`: en Fabricación aparece el botón «Subir PDF de fórmula»; ya no existe «Escanear hoja» en ningún tipo.
- [ ] **Step 2:** Correr → falla.
- [ ] **Step 3: Implementar.** En `NuevaOrden`, tipo Fabricación: botón «Subir PDF de fórmula» que alterna entre el formulario manual y `<SubirFormula>`; al terminar de crear todas (`onCreadas`) se llama `onCreada()`. El formulario manual de fabricación suma el campo opcional «Vencimiento» (`NuevaFabricacion.vencimiento?: string | null`, se inserta tal cual). Envasado/Fraccionado quedan solo manuales. Quitar `escaneando`, `avisosEscaneo`, `aplicarHoja` y el import de `aplicarEscaneo`. Cada tarjeta: selects Tanque (solo `libres`), Producto, Operaria (opcional), input `type="date"` Vencimiento; un tanque elegido en una tarjeta desaparece de las otras.
- [ ] **Step 4:** `npx vitest run src/panel src/domain` → PASS; `npm run lint` y `npm run typecheck` limpios.
- [ ] **Step 5: Commit** — `feat(panel): nueva fabricación subiendo el PDF de la fórmula`

### Task 5: Tablet — checklist de MP

**Files:**
- Create: `src/planta/ChecklistMp.tsx`, `src/planta/checklistMp.test.tsx`
- Modify: `src/planta/TarjetaTarea.tsx`, `src/planta/MisTareas.tsx`, `src/planta/PlantaApp.tsx`, `src/planta/planta.css`

**Interfaces:**
- Consumes: `cargarMpDe`, `guardarMp`, `FilaMp` (Task 3); `Tarea.mp_total`, `Tarea.mp_completas`.
- Produces: `<ChecklistMp fabricacionId empleadoId pin habilitado onCambio={(completas: number) => void} />`; `TarjetaTarea` recibe prop opcional `checklist?: ReactNode` y `bloqueoFinalizar?: string | null` (texto que reemplaza la acción Finalizar deshabilitada).
- [ ] **Step 1: Tests que fallan** (mock de `datosMp`/`acciones`):
  - Muestra las 4 filas (código, descripción, cantidad) con input «Lote de 900101» y casilla «Pesado 900101»; contador «0 de 4 MP».
  - Escribir lote y salir del campo (`blur`) llama `guardarMp({id, lote, pesado:false, empleadoId, pin})`; tildar pesado llama con `pesado:true`; con lote y pesado la fila se marca completa (`aria-label` «900101 completa») y el contador pasa a «1 de 4 MP».
  - Error de `guardarMp` → `role="alert"` en la fila y el valor queda escrito.
  - `TarjetaTarea` de fabricación `fabricando` con `mp_total 4, mp_completas 3`: el botón Finalizar está deshabilitado y se lee «Faltan 1 MP por completar»; con 4/4 está habilitado; fabricación con `mp_total 0` → sin checklist y Finalizar normal.
- [ ] **Step 2:** Correr → falla.
- [ ] **Step 3: Implementar.** `MisTareas` pasa `checklist` solo para tareas propias `entidad==='fabricacion'`, estado `fabricando|pausada`, `mp_total > 0`. `PlantaApp` pasa `pin` y `empleadoId` (ya los tiene en memoria). El contador local manda en la tarjeta mientras Realtime trae `v_tareas` actualizada. Si `accion` devuelve `MP_INCOMPLETA`, se muestra su texto en el aviso existente.
- [ ] **Step 4:** `npx vitest run src/planta` → PASS; lint y typecheck limpios.
- [ ] **Step 5: Commit** — `feat(planta): checklist de materias primas con lote y pesado`

### Task 6: Panel — ver MP, lote y vencimiento

**Files:**
- Create: `src/panel/TablaMp.tsx`, `src/panel/tablaMp.test.tsx`
- Modify: `src/panel/DetalleTanque.tsx`, `src/panel/historial/Historial.tsx`, `src/panel/datosTanque.ts` (traer `vencimiento`), `src/panel/panel.css`

**Interfaces:**
- Consumes: `cargarMpDe`, `FilaMp` (Task 3); `v_operarias` para nombre de `cargado_por`.
- Produces: `<TablaMp fabricacionId: string />` — tabla Código / Descripción / Cantidad / Lote / Pesado / Cargó / Hora; «Sin materias primas (orden cargada a mano)» si no hay filas.
- [ ] **Step 1: Tests que fallan:** `TablaMp` con 2 filas muestra «L-55», «✓», «Laura Paz», hora `HH:MM`; vacío → el texto de sin MP.
- [ ] **Step 2:** Implementar. `DetalleTanque`: debajo de los datos de la fabricación muestra «Lote 17702 · Vence 21/10/2028» y `<TablaMp>`. `Historial`: en filas de fabricación, botón «Ver MP» que despliega `<TablaMp>` debajo de la fila.
- [ ] **Step 3:** `npx vitest run src/panel` → PASS.
- [ ] **Step 4: Commit** — `feat(panel): trazabilidad de MP en detalle de tanque e historial`

### Task 7: Limpieza, demo y e2e

**Files:**
- Delete: `supabase/functions/escanear-hoja/`; de `src/domain/escaneo.ts` quitar `DatosEscaneo`, `CatalogosEscaneo`, `aplicarEscaneo`, `normalizarPresentacion` y sus tests (conservar `normalizarNombre`, `aNumero`, `coincidir`, `buscarEnCatalogo`); `escanearHoja` de `datosOrden.ts`
- Modify: `src/demo/fetchDemo.ts`, `src/demo/simulador.ts`, `src/demo/fetchDemo.test.ts`, `e2e/mocks.ts`, `e2e/nueva-orden.spec.ts`, `e2e/analisis.spec.ts`, `e2e/planta.spec.ts`
- [ ] **Step 1: Demo, test primero** en `fetchDemo.test.ts`: `rpc/crear_fabricacion_formula` crea la fabricación y sus MP en el simulador (`{ok:true,id}`); `rpc/cargar_mp` actualiza la fila; `rpc/accion` finalizar con MP incompleta → `MP_INCOMPLETA`; `fabricacion_mp?fabricacion_id=eq.<id>` devuelve las filas; `v_tareas` trae `mp_total/mp_completas`. Reemplazar el test «el escáner de hojas no se usa en la demo». Implementar en `simulador.ts` (MP en memoria) y `fetchDemo.ts`.
- [ ] **Step 2: e2e.** `mocks.ts`: quitar la ruta `functions/v1/escanear-hoja`; agregar `rpc/crear_fabricacion_formula`, `rpc/cargar_mp`, `fabricacion_mp`. `nueva-orden.spec.ts`: Fabricación → «Subir PDF de fórmula» → `setInputFiles('e2e/fixtures/BACTIPRO.pdf')` (lectura real con pdf.js) → tarjeta «Lote 17702» → tanque + vencimiento → Crear → «Creada». `analisis.spec.ts`: quitar el tramo de escaneo. `planta.spec.ts`: fabricación con MP → Finalizar deshabilitado → completar 4 MP → Finalizar. Capturas 1440×900 (panel) y tablet como en los specs existentes.
- [ ] **Step 3:** `npm run lint && npm run typecheck && npx vitest run && npm run e2e` → todo verde. `grep -ri "escanear" src e2e supabase` → sin resultados.
- [ ] **Step 4: Commit** — `chore: quitar escaneo con IA; demo y e2e con PDF de fórmula`
- [ ] **Step 5: Publicar con OK del usuario** (push a main + `gh workflow run deploy.yml …`). Verificar en la URL publicada: subir `BACTIPRO.pdf` en `/panel` (sin crear, o creando en un tanque libre y cancelando después, a elección del usuario) y proponerle la prueba real en la tablet. Actualizar la memoria `prodcontrol-infra` (migración 011 aplicada, escaneo IA eliminado).
