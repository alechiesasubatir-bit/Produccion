# ProdControl · Plan 4 — Análisis: Historial, KPIs, Alertas, CSV y Escanear hoja Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar la paridad con la app vieja (spec §9): historial con vista mensual y CSV, KPIs (operaciones, productos, ranking, tiempos vs. estándar) con CSV, proyecciones de tiempo, alertas automáticas con `pg_cron` (marcar leída, posponer, sonido) y escaneo de la hoja Macrosoft con IA.

**Architecture:** La base agrega `v_historial` (todas las tareas con tiempos y nombres), `v_tiempos_estandar` (velocidades históricas) y la función `revisar_alertas()` que corre cada 10 min con `pg_cron`. Los KPIs y agrupaciones se calculan en el front con funciones puras sobre `v_historial` filtrado por rango (testeables). El escaneo es una Edge Function `escanear-hoja` que llama a la API de Claude con la clave guardada como secreto de Supabase; el front nunca ve la clave.

**Tech Stack:** igual que planes 1-3 + `pg_cron` + Supabase Edge Functions (Deno) + `@anthropic-ai/sdk` (vía `npm:`) + `zod`.

**Spec:** `docs/superpowers/specs/2026-10-20-prodcontrol-rediseno-design.md` (§4.3, §4.4, §5.1 Historial/KPIs/Alertas, §7 escaneo, §9 paridad). **Referencia de la app vieja:** `C:\Users\alech\Downloads\ProdControl_2026-10-20.html` — `calcProyFab`/`calcProyEnv` (≈ línea 909), `checkProduccionAlerts`/`checkTimeouts` (≈ 1132, 1211), `renderKPIs` (≈ 337), `renderHistMensual` (≈ 1315), `_doFetch` con los tres prompts de escaneo (≈ 1530), `expCSV` (≈ 1768).

**Base existente:** ver planes 1-3. Relevante: `v_tiempos_efectivos` (min_brutos, min_pausa, min_efectivos por tarea desde `eventos`), `v_flujo`, `alertas` (tabla con RLS panel: lectura panel+planta, escritura panel), `accionPanel`, `useRealtime`, `fetchAll`, `mensajeError`, `PanelApp` con pestañas, `NuevaOrden`, `datosOrden.ts`, `panel.css`. Tests SQL: pgTAP vía `execute_sql` (`begin` + `_fixtures.sql` + test, salida en `_tap`).

## Global Constraints

- Proyecto **Plataforma** `iyqufnmpjkyfzspujwyf`. **OK del usuario antes de cada `apply_migration`, antes de instalar `pg_cron` y antes de desplegar la Edge Function**; ensayar migraciones en `begin … rollback`. Actualizar `database.types.ts` a mano.
- Publicar = merge `--ff-only` a `main`, push con `alechiesasubatir-bit`, `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main`, volver a `achiesa77-ctrl`.
- Navegación del panel: **Flujo · Tanques · Historial · KPIs · Alertas · Configuración**; rutas `/panel/historial`, `/panel/kpis`, `/panel/alertas`. La pestaña Alertas muestra un contador de no leídas.
- Fechas y "día" siempre en `America/Montevideo`. Números con formato `es-UY`.
- CSV: separador `;`, decimales con coma, UTF-8 con BOM (abre bien en Excel en español), encabezados en español, nombre `prodcontrol-<vista>-<desde>_<hasta>.csv`.
- Tiempos: **efectivos** (descuentan pausas) en toda la app; la app vieja usaba brutos para proyectar — acá se usan efectivos.
- Alertas (paridad con la app vieja): `exceso_9h` (fabricación `fabricando|pausada` o envasado `activo|pausado` con más de 9 h desde el inicio), `desvio_estandar` (envasado `activo` cuyo tiempo efectivo superó lo estimado por `v_tiempos_estandar`), `pausa_larga` (envasado `pausado` hace más de 30 min), `falta_envasado` (fabricación `para_envasar` sin ningún envasado). Una alerta por `(tipo, entidad_id)`. Posponer: **1 hora · 4 horas · 1 día**.
- Escaneo: modelo `claude-opus-5` con salida estructurada (`client.messages.parse` + `zodOutputFormat`), fallbacks de refusal del servidor habilitados (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); prompts **iguales a la app vieja** (ver referencia) salvo pedir JSON (lo garantiza el schema). La imagen se reduce en el navegador a ≤ 800 px, JPEG 0.6 (como la app vieja). Si la función falla o devuelve algo inválido, el formulario queda editable a mano con aviso (spec §7).
- `prefers-reduced-motion` y offline como en los planes anteriores. Verificación visual a 1440×900.

## Review Focus

1. **Una tarea cruza la medianoche** (empieza 23:30, termina 01:15) → en el historial y el calendario cuenta en el día de **fin** si está terminada, en el de inicio si no; nunca dos veces. (Test en Task 2.)
2. **Posponer y que la condición siga** → la alerta no reaparece antes de `pospuesta_hasta`, y `revisar_alertas()` no crea un duplicado. (Test en Task 1.)
3. **Productos o nombres con `;`, comillas o saltos de línea** en el CSV → se escapan; el archivo abre con las columnas correctas. (Test en Task 2.)
4. **El escaneo devuelve un producto que no existe en el catálogo** o cantidades con coma de miles (`1,000.000`) → el formulario se precarga con lo que matchea, marca lo que no ("No encontré «X» en productos"), y nunca multiplica por 1000. (Test en Task 7.)
5. **Rango de fechas con más de 1000 tareas** → el historial y los KPIs usan `fetchAll` (paginado) y los totales coinciden con la base. (Test en Task 3: `fetchAll` llamado con `range` sucesivos.)

---

## File Structure

```
supabase/migrations/20261023000008_produccion_analisis.sql   # v_historial, v_tiempos_estandar, alertas (tipos, revisar_alertas, cron, realtime)
supabase/tests/analisis.test.sql
supabase/functions/escanear-hoja/index.ts                     # Edge Function (Deno)
src/lib/database.types.ts
src/domain/historial.ts  kpis.ts  csv.ts  proyecciones.ts  escaneo.ts   (+ tests)
src/panel/historial/Historial.tsx  Calendario.tsx  datosHistorial.ts
src/panel/kpis/Kpis.tsx
src/panel/alertas/Alertas.tsx  useAlertas.ts
src/panel/EscanearHoja.tsx
src/panel/PanelApp.tsx  NuevaOrden.tsx  TarjetaFlujo.tsx  panel.css   (modificar)
e2e/analisis.spec.ts  e2e/mocks.ts
```

---

### Task 1: Migración 008 — historial, estándares y alertas automáticas

**Files:**
- Create: `supabase/migrations/20261023000008_produccion_analisis.sql`, `supabase/tests/analisis.test.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Produces:
  - `produccion.v_historial` (`security_invoker`): una fila por tarea (todas, cualquier estado): `entidad, id, estado, producto, color, tanque_codigo, presentacion, cantidad int null, litros numeric null, litros_equiv numeric null, lote, descripcion, operaria_1, operaria_1_nombre, operaria_2, operaria_2_nombre, inicio, fin, created_at, min_brutos, min_pausa, min_efectivos` (de `v_tiempos_efectivos`), `dia date` = fecha Montevideo de `coalesce(fin, inicio, created_at)`.
  - `produccion.v_tiempos_estandar` (`security_invoker`): `entidad ('fabricacion'|'envasado'), clave text` (nombre de producto para fabricación, de presentación para envasado), `velocidad numeric` (fabricación: L/min; envasado: unidades/min — promedio de `litros|cantidad / min_efectivos` de las terminadas con `min_efectivos > 0.1`), `muestras int`, `litros_hora_std numeric null` (de `productos`, solo fabricación).
  - `alertas.tipo` acepta `exceso_9h | desvio_estandar | pausa_larga | falta_envasado`; índice único `alertas_tipo_entidad_uk (tipo, entidad_id)`.
  - `produccion.revisar_alertas() returns int` (`security definer`, `search_path=''`): inserta `on conflict do nothing` las alertas de Global Constraints con `texto` en español como la app vieja (p. ej. `"Fabricación de Lavandina en T-03 lleva más de 9 horas."`, `"Envasado de Lavandina (5L) lleva más de 30 min pausado."`, `"Envasado de Lavandina (5L) superó el tiempo estimado (42 min)."`, `"Falta cargar el envasado de Lavandina — tanque T-03, listo para envasar."`); devuelve cuántas creó. Ejecutable solo por `postgres`/cron (revoke de public, anon, authenticated).
  - `pg_cron`: `cron.schedule('produccion-revisar-alertas', '*/10 * * * *', 'select produccion.revisar_alertas()')`.
  - `produccion.alertas` en la publicación `supabase_realtime`.
- [ ] **Step 1: `analisis.test.sql`** — `plan(7)`:
  - `v_historial`: envasado terminado con 2 eventos de pausa trae `min_efectivos` y `operaria_1_nombre = 'Laura Paz'`; `dia` de una tarea iniciada `2026-01-05 23:30-03` y finalizada `2026-01-06 01:15-03` = `2026-01-06`
  - `v_tiempos_estandar`: dos fabricaciones de Lavandina-test de 600 L en 60 y 120 min efectivos → `velocidad = 7.5`
  - `revisar_alertas()`: fabricación `fabricando` con inicio hace 10 h → crea 1 `exceso_9h`; correrla de nuevo → 0 nuevas
  - alerta con `pospuesta_hasta` futuro y la condición vigente → `revisar_alertas()` no duplica (sigue habiendo 1)
  - fabricación `para_envasar` sin envasados → `falta_envasado`; envasado `pausado` hace 40 min → `pausa_larga`
  - como `U_TABLET`: `throws_ok('select produccion.revisar_alertas()', '42501')`
- [ ] **Step 2: Ver fallar. Step 3: Escribir la migración** (sin `create extension pg_cron` ni `cron.schedule`: van en el Step 5).
- [ ] **Step 4: Ensayar** (`ok 1..7`).
- [ ] **Step 5: OK del usuario** para (a) aplicar la migración y (b) instalar `pg_cron` y programar la tarea; aplicar `produccion_analisis` y luego una migración chica `produccion_cron` con `create extension if not exists pg_cron` + `cron.schedule(...)`. Verificar con `select * from cron.job`.
- [ ] **Step 6: Re-correr contra lo aplicado** (`ok 1..7`) + `rpc.test.sql` (`ok 1..12`). `get_advisors(security)`.
- [ ] **Step 7: Tipos** (`v_historial`, `v_tiempos_estandar`, `alertas.tipo` ampliado). **Step 8: Commit** — `feat(db): historial, tiempos estándar y alertas automáticas con pg_cron`

---

### Task 2: Dominio — historial, KPIs, CSV y proyecciones

**Files:**
- Create: `src/domain/historial.ts`, `kpis.ts`, `csv.ts`, `proyecciones.ts` y sus `.test.ts`

**Interfaces:**
- Produces:
  - `type FilaHistorial` = fila de `v_historial`. `type Rango = { desde: string; hasta: string }` (fechas `YYYY-MM-DD`, inclusivas).
  - `filtrarHistorial(filas, f: { entidad?: Entidad | ''; estado?: string; texto?: string }): FilaHistorial[]` — texto busca en producto, lote, tanque, presentación y nombres (sin distinguir mayúsculas ni tildes).
  - `ordenarHistorial(filas, por: keyof FilaHistorial, asc: boolean)`.
  - `porDia(filas): Map<string, FilaHistorial[]>` (usa `dia`); `diasDelMes(anio, mes): string[]` (semana empieza lunes, con relleno de días de meses vecinos para la grilla).
  - `rankingOperarias(filas)` → `{ nombre, tareas, unidades, minutos, unidadesPorMin }[]` (envasados terminados; cuenta a operaria_1 y operaria_2; orden por unidades desc) — como `renderKPIs` de la app vieja.
  - `porProducto(filas)` → `{ producto, presentacion, tareas, unidades, litros, unidadesPorMin }[]`.
  - `resumenOperaciones(filas)` → `{ fabricaciones, envasados, fraccionados, litrosFabricados, unidadesEnvasadas, minutosEfectivos, minutosPausa }` (solo terminadas).
  - `tiemposVsEstandar(filas, estandar)` → por producto: `{ producto, real (L/min promedio en el rango), estandar (litros_hora_std/60 o velocidad histórica), desvioPct }`.
  - `aCSV(columnas: { titulo: string; valor: (f) => string | number | null }[], filas): string` — BOM + `;`, decimales con coma, escapa `;`, `"` y saltos de línea entre comillas; `descargarCSV(nombre, contenido)` (Blob + `a[download]`).
  - `proyeccionFabricacion(litros, estandar?: { velocidad: number } | null): number | null` (minutos) y `proyeccionEnvasado(cantidad, estandar?)`; `textoProyeccion(min, velocidad, unidad: 'L' | 'u'): string` → `"~42 min (histórico 14,3 L/min)"`.
- [ ] **Step 1: Tests:** cruce de medianoche (Focus 1, vía `porDia` con filas de `dia` distinto: una fila nunca aparece en dos días); `filtrarHistorial` con "lavandína" encuentra "Lavandina"; `rankingOperarias` suma a las dos operarias de un envasado; `aCSV` con producto `Cloro; "fuerte"` y salto de línea → celda `"Cloro; ""fuerte"""` y decimales `1,5`; empieza con `\uFEFF`; `proyeccionFabricacion(600, {velocidad: 7.5})` → `80`; sin estándar → `null`; `diasDelMes(2026, 10)` empieza en lunes 2026-09-28 y tiene 35 o 42 días.
- [ ] **Step 2-4: Ver fallar, implementar, ver pasar. Step 5: Commit** — `feat(domain): historial, KPIs, CSV y proyecciones`

---

### Task 3: Historial (tabla, calendario y CSV)

**Files:**
- Create: `src/panel/historial/Historial.tsx`, `Calendario.tsx`, `datosHistorial.ts`, `historial.test.tsx`
- Modify: `src/panel/PanelApp.tsx` (pestaña y ruta), `src/panel/panel.css`

**Interfaces:**
- Consumes: Task 2; `fetchAll`.
- Produces:
  - `cargarHistorial(r: Rango): Promise<FilaHistorial[]>` — `fetchAll` sobre `v_historial` con `.gte('dia', desde).lte('dia', hasta).order('dia', {ascending:false}).order('id')`.
  - `<Historial />` — barra: rango (inputs `date` "Desde"/"Hasta", atajos "Hoy · Esta semana · Este mes · Mes anterior"), tipo, estado, búsqueda, conmutador **Tabla · Mes · Semana**, botón **Exportar CSV**. Tabla densa ordenable por clic en encabezado (`aria-sort`): Día, Tipo, Producto, Presentación, Cant./Litros, Lote, Tanque, Operaria(s), Inicio, Fin, Efectivo (`formatoCronometro`), Pausas, Estado (`<Chip>`). Clic en una fila de una fabricación abierta → lleva a `/panel/tanques` con ese tanque elegido (query `?tanque=`).
  - `<Calendario modo: 'mes' | 'semana'; rango; filas; onElegirDia(dia) />` — mes: grilla lunes-domingo con contadores por tipo y litros fabricados del día; semana: 7 columnas con las tareas del día. Elegir un día pasa a Tabla con `desde = hasta = día`. Navegación ‹ › de mes/semana actualiza el rango.
  - CSV con las columnas de la tabla → `prodcontrol-historial-<desde>_<hasta>.csv`.
- [ ] **Step 1: Tests** (mock de `datosHistorial`): carga con el rango "Este mes" por defecto; ordenar por "Efectivo" alterna `aria-sort`; filtro de texto reduce filas; "Exportar CSV" llama `descargarCSV` con nombre `prodcontrol-historial-2026-10-01_2026-10-31.csv` (fecha fija con fake timers) y contenido con encabezado `Día;Tipo;Producto…`; en modo Mes, clic en el día 15 muestra la tabla de ese día; Focus 5: `cargarHistorial` usa `fetchAll` (test unitario de `datosHistorial` con `db` mockeado: 2 páginas).
- [ ] **Step 2-4. Step 5: Commit** — `feat(panel): historial con calendario y exportación CSV`

---

### Task 4: KPIs y proyecciones

**Files:**
- Create: `src/panel/kpis/Kpis.tsx`, `kpis.test.tsx`
- Modify: `src/panel/PanelApp.tsx`, `src/panel/NuevaOrden.tsx` (+ `datosOrden.ts`: estándares), `src/panel/TarjetaFlujo.tsx`, `panel.css`

**Interfaces:**
- Consumes: Task 2; `cargarHistorial`; `v_tiempos_estandar`.
- Produces:
  - `<Kpis />` — mismo selector de rango que Historial; tarjetas de resumen (`resumenOperaciones`, contadores animados como el Flujo); sub-pestañas **Operaciones · Productos · Ranking · Tiempos vs. estándar**, cada una con su tabla y **Exportar CSV** (`prodcontrol-kpis-<pestaña>-<desde>_<hasta>.csv`). Ranking con 🥇🥈🥉 en los tres primeros (como la app vieja). Tiempos vs. estándar: desvío en verde (≤ 0 %), ámbar (≤ 20 %), rojo (> 20 %).
  - `NuevaOrden`: debajo de litros/cantidad, `textoProyeccion` si hay estándar ("~80 min (histórico 7,5 L/min)").
  - `TarjetaFlujo`: si la tarea está corriendo y hay estándar, barra fina de avance `min_efectivos / proyección` (máx. 100 %; en rojo si se pasó).
- [ ] **Step 1: Tests:** ranking muestra 🥇 en la operaria con más unidades; pestaña Tiempos marca en rojo un desvío de 35 %; CSV de Productos con nombre correcto; `NuevaOrden` con estándar 7,5 L/min y 600 L muestra "~80 min (histórico 7,5 L/min)"; sin historial no muestra nada.
- [ ] **Step 2-4. Step 5: Commit** — `feat(panel): KPIs con exportación y proyecciones de tiempo`

---

### Task 5: Alertas

**Files:**
- Create: `src/panel/alertas/Alertas.tsx`, `useAlertas.ts`, `alertas.test.tsx`
- Modify: `src/panel/PanelApp.tsx` (pestaña con contador, sonido), `panel.css`

**Interfaces:**
- Produces:
  - `useAlertas(): { activas: Alerta[]; todas: Alerta[]; noLeidas: number; recargar }` — `useRealtime` sobre `alertas` (canal `alertas`); `activas` = `!leida && (pospuesta_hasta null || < ahora)`, reevaluado cada minuto.
  - `<Alertas />` — lista de activas arriba (texto, hace cuánto, botón "Ver" que lleva al tanque o al flujo, **Marcar leída**, **Posponer 1 hora · 4 horas · 1 día** → `update({pospuesta_hasta})`), luego "Leídas y pospuestas" atenuadas; interruptor **Sonido** (preferencia en `localStorage['prodcontrol_sonido']`, try/catch).
  - En `PanelApp`: la pestaña "Alertas" muestra `noLeidas` en un globo; cuando aparece una alerta activa nueva y el sonido está activado, suena un tono corto (Web Audio, 2 notas, sin archivo); nunca suena al cargar la página por primera vez.
- [ ] **Step 1: Tests:** posponer 4 horas llama `update({pospuesta_hasta: <ahora + 4 h>})` (fake timers) y la alerta pasa a la sección de pospuestas; una alerta con `pospuesta_hasta` vencido vuelve a activas; el globo muestra 2 con dos activas; con sonido activado y una alerta nueva por Realtime, se llama al reproductor una vez (mock de `AudioContext`); al montar con alertas existentes no suena.
- [ ] **Step 2-4. Step 5: Commit** — `feat(panel): alertas con posponer y sonido`

---

### Task 6: Edge Function `escanear-hoja`

**Files:**
- Create: `supabase/functions/escanear-hoja/index.ts`, `src/domain/escaneo.ts`, `src/domain/escaneo.test.ts`

**Interfaces:**
- Produces:
  - Edge Function (Deno, `verify_jwt: true`): `POST { tipo: 'fabricacion'|'envasado'|'fraccionado', imagen: string /* base64 JPEG sin prefijo */ }` → `200 { ok: true, datos }` o `{ ok: false, error: string }`. Verifica que quien llama sea panel (`supabase.rpc('es_panel')` con el JWT del request). Usa `import Anthropic from "npm:@anthropic-ai/sdk"`, `import { z } from "npm:zod"`, `import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod"`; `messages.parse` con `model: "claude-opus-5"`, `max_tokens: 4096`, contenido `[{type:'image', source:{type:'base64', media_type:'image/jpeg', data}}, {type:'text', text: PROMPT[tipo]}]`, `output_config: { format: zodOutputFormat(SCHEMA[tipo]) }`, y fallbacks del servidor (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` — si `messages.parse` no acepta `betas`/`fallbacks`, usar `client.beta.messages.parse` según la doc del SDK vía `shared/live-sources.md` de la skill claude-api; no adivinar). Chequear `stop_reason === "refusal"` antes de leer `parsed_output`. Clave en el secreto `ANTHROPIC_API_KEY` (nunca en el repo ni en el front). CORS para el origen de Pages y `localhost`.
  - Schemas (de los prompts de la app vieja): fabricación `{ lote: string, fecha: string, producto: string, cantidad: number }`; envasado `{ fecha: string, granel: string, presentaciones: {nombre: string, cantidad: number}[] }`; fraccionado `{ lote: string, fecha: string, producto: string, presentaciones: {nombre, cantidad}[] }`.
  - `src/domain/escaneo.ts`: `normalizarNombre(s)` (minúsculas, sin tildes, sin espacios repetidos), `buscarEnCatalogo(nombre, catalogo: {id, nombre}[]): {id, nombre} | null` (exacto normalizado, si no "contiene"), `normalizarPresentacion(s)` (`1/2 kg`→`500g`, `1/4 kg`→`250g`, `1 lt`→`1L`, `x 5 L`→`5L`, como la app vieja), `aNumero(v)` (acepta number o string `1,000.000`/`800.000` con coma de miles y punto decimal → `1000`/`800`, nunca ×1000).
- [ ] **Step 1: Tests de `escaneo.ts`:** `aNumero('1,000.000')` → `1000`; `aNumero('800.000')` → `800`; `aNumero(3000)` → `3000`; `buscarEnCatalogo('LAVANDINA CONCENTRADA', [{nombre:'Lavandina concentrada'}])` encuentra; `normalizarPresentacion('x 5 L')` → `'5L'`; producto inexistente → `null`.
- [ ] **Step 2-4: Ver fallar, implementar, ver pasar.** La función se type-checkea con `npx deno check` si Deno está disponible; si no, revisar a mano contra la doc del SDK (ledger).
- [ ] **Step 5: Pedir al usuario** que cargue el secreto `ANTHROPIC_API_KEY` en Studio → Edge Functions → Secrets (Claude no maneja la clave). **OK del usuario y desplegar** con `deploy_edge_function` (`verify_jwt: true`). Probar con `curl` con el JWT de un usuario panel y una imagen de prueba que provea el usuario (o una hoja fotografiada); sin imagen, al menos verificar que sin JWT da 401 y con la tablet da 403.
- [ ] **Step 6: Commit** — `feat(escaneo): Edge Function escanear-hoja con Claude y normalización`

---

### Task 7: Escanear hoja en Nueva orden

**Files:**
- Create: `src/panel/EscanearHoja.tsx`, `src/panel/escanear.test.tsx`
- Modify: `src/panel/NuevaOrden.tsx`, `datosOrden.ts` (`escanearHoja(tipo, imagen)` → `supabase.functions.invoke('escanear-hoja', {body})`)

**Interfaces:**
- Produces:
  - `<EscanearHoja tipo onDatos(d) onCancelar />` — dentro de Nueva orden, botón **"Escanear hoja"**: input de archivo `accept="image/*" capture="environment"`, vista previa, **Analizar**; reduce la imagen con canvas (≤ 800 px, JPEG 0.6; si > 500 KB, 70 % y 0.5 — igual que la app vieja); estado "Analizando…"; error → mensaje y el formulario sigue editable.
  - `aplicarEscaneo(tipo, datos, catalogos) → { campos: Partial<...>, avisos: string[] }` (puro, en `escaneo.ts`): fabricación → producto (por catálogo), litros (`aNumero(cantidad)`), lote; envasado → tanque a envasar cuyo producto coincide con `granel`, primera presentación encontrada + cantidad (avisa si hay más de una: "La hoja trae 3 presentaciones; cargá una orden por cada una."); fraccionado → producto, lote, primera presentación + cantidad. Lo que no matchea va a `avisos` ("No encontré «X» en productos.").
- [ ] **Step 1: Tests:** `aplicarEscaneo('fabricacion', {producto:'LAVANDINA', cantidad:'3,000.000', lote:'123'})` precarga producto y 3000 L; producto desconocido → aviso y campo vacío (Focus 4); en el componente, la función devolviendo `{ok:false}` muestra el error y deja el formulario editable; un escaneo exitoso llena los campos y muestra los avisos en `role="status"`.
- [ ] **Step 2-4. Step 5: Commit** — `feat(panel): escanear hoja Macrosoft en nueva orden`

---

### Task 8: E2E, verificación y publicación

- [ ] **Step 1:** `e2e/analisis.spec.ts` (API simulada, incluida `functions/v1/escanear-hoja`): Historial → filtro → CSV descargado (`page.waitForEvent('download')`) con el nombre esperado; KPIs → Ranking; Alertas → posponer 1 hora; Nueva orden → Escanear hoja con una imagen de prueba (`setInputFiles`) → campos precargados. Capturas 1440×900.
- [ ] **Step 2:** `npx playwright test` → 3 passed; revisar capturas.
- [ ] **Step 3: Commit** — `test(e2e): historial, KPIs, alertas y escaneo`
- [ ] **Step 4: Publicar (OK del usuario)** y verificar `/panel/historial` publicado. Proponer al usuario hacer en la misma sesión la prueba real pendiente del plan 3 (operaria con PIN → tablet toma PRUEBA-001) y un escaneo real con una hoja Macrosoft fotografiada.
