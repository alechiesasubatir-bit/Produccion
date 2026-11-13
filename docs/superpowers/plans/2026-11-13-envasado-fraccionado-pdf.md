# Envasado y fraccionado desde PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir la hoja «Movimientos de Produccion — Fabrica Envasado» y crear desde ella envasados (con tanque sugerido, granel de stock o «esperando fabricación») y fraccionados, con consumibles cuyo lote la operaria carga opcionalmente; editar envasados según estado.

**Architecture:** Migración 017 vuelve opcional `envasados.fabricacion_id`, agrega datos del documento, la tabla `consumibles`, `fabricaciones.origen`, las RPC `crear_envasado_documento` / `crear_fraccionado_documento` / `crear_granel_stock` / `cargar_consumible` y un trigger de reglas de edición. Un parser nuevo (`envasadoPdf.ts`) reutiliza la reconstrucción de grilla de `formulaPdf.ts`. El panel muestra tarjetas por bloque; la tablet un checklist opcional de consumibles.

**Tech Stack:** Postgres/Supabase (plpgsql, pgTAP), React 19 + TS, pdf.js, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-envasado-fraccionado-pdf-design.md`

## Global Constraints

- Migración nueva: `supabase/migrations/20261113000017_produccion_envasado_documento.sql`. NO aplicar a producción (`iyqufnmpjkyfzspujwyf`) sin OK del usuario. Al publicar: primero migración, verificar, después push/deploy (nunca en paralelo).
- Tests SQL: el implementador NO llama `execute_sql`; genera en el scratchpad un `all.sql` (`begin;` + 017 + `_fixtures.sql` + cada `supabase/tests/*.test.sql` en su savepoint, contador por archivo en secuencias temporales, devuelve `archivo | ok | fallas`, termina en `rollback;`; líneas de comentario y `select l from _tap…`/`rollback;` finales de cada test quitados) y avisa; el controlador lo corre. 001–016 ya están aplicadas.
- RPC: security definer, `search_path = ''`, errores de negocio `{ok:false, codigo, detalle}` (internos SQLSTATE `PC001`). Códigos nuevos: `SIN_TANQUE`, `GRANEL_DISTINTO`, `NO_EDITABLE`, `TANQUE_EN_USO`; agregarlos a `src/lib/errores.ts` con texto en español. Reusar `NO_AUTORIZADO`, `NO_ENCONTRADO`, `TRANSICION_INVALIDA`, `DATOS_INVALIDOS`, `NO_PARTICIPA`, `OPERARIA_INACTIVA`, `TANQUE_OCUPADO`.
- Columnas nuevas de vistas siempre al final; partir de las definiciones de 015. `src/lib/database.types.ts` se edita a mano.
- Repo PÚBLICO: los PDF reales del usuario NO se copian ni se commitean. Fixtures con datos inventados generados con `scripts/pdf-desde-fragmentos.mjs` (granel «F9 Limpiador Prueba (Granel)», productos «Limpiador Prueba x 1.5 L», «Polvo Prueba pote x 1/2 Kg», códigos 9xxxxx).
- Estilo: comillas simples, sin punto y coma, español rioplatense.
- Textos exactos: botón «Subir PDF»; opciones de tanque «Granel de stock en un tanque libre…», «Esperando fabricación»; aviso «Este documento ya se cargó (lote <n>). ¿Crear igual?»; sección del flujo «Esperando fabricación»; botón «Asignar tanque»; botón «Editar»; aviso de tipo de hoja «Es una hoja de envasado: la abrí en Envasado.» / «Es una fórmula: la abrí en Fabricación.»; historial «Granel de stock».
- Vitest: `npx vitest run src --exclude ".claude/**"`. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Envasados sin fabricación: cualquier consulta con `join fabricaciones` (vistas, `accion()`, cierre automático, `revisar_alertas`, `restantes`, KPIs) los pierde o se rompe con null. `v_tareas` debe excluirlos; `v_flujo`/`v_historial` mostrarlos (left join). Tests en Tasks 1 y 3.
2. Cambiar el tanque de un envasado deja huérfana la fabricación vieja: si era el último envasado abierto y ya estaba envasada del todo, no se cierra sola. Aceptado (la encargada la finaliza con merma); test que documenta que la fabricación vieja sigue `para_envasar`. Task 2.
3. Parser: un bloque cuyo cierre está partido en dos renglones, o un comprobante con renglón de fórmula y de envasado a la vez (no debería existir) → se trata como fórmula. Tests en Task 4.
4. Lote duplicado por doble click en «Crear todas»: el botón se deshabilita mientras crea (patrón de `SubirFormula`). Test en Task 6.
5. Consumible cargado por una operaria que no participa (con participaciones abiertas) → `NO_PARTICIPA`; sin participaciones abiertas carga cualquier activa (mismo criterio que `cargar_mp`). Task 2.

---

### Task 1: Esquema, granel de stock y `accion()`

**Files:** Create la migración 017 (sección 1. Esquema + `crear_granel_stock` + `accion()`); Create `supabase/tests/envasado_documento.test.sql`.

**Produces:**
- `envasados`: `fabricacion_id` nullable; columnas `lote text`, `codigo text`, `descripcion text`, `granel_id uuid references produccion.productos`, `litros_granel numeric check (> 0)`; check `envasados_origen_ck (fabricacion_id is not null or granel_id is not null)`; índice en `granel_id`.
- `fraccionados`: columna `codigo text`.
- `fabricaciones.origen text not null default 'formula' check (origen in ('formula','stock'))`.
- Tabla `produccion.consumibles` (spec §1), RLS lectura `es_panel() or es_planta()`, sin grants de escritura, en `supabase_realtime`.
- `crear_granel_stock(p_tanque_id uuid, p_producto_id uuid, p_litros numeric, p_lote text) returns jsonb` → `{ok:true, id}`; solo panel; fabricación en `para_envasar`, `origen 'stock'`, `inicio = fin = now()`; el evento `crear` lo registra el trigger de 007 (no se agrega otro). Tanque ocupado → `TANQUE_OCUPADO`; litros ≤ 0 o > capacidad → `DATOS_INVALIDOS`.
- `accion()` (copiar la de 015): `iniciar`/`sumarse` de un envasado con `fabricacion_id null` → `SIN_TANQUE`; el cierre automático (paso 10) no corre si `v_fab_id` es null.
- `v_tiempos_estandar` excluye `origen = 'stock'`.

- [ ] Tests: insertar envasado con `fabricacion_id null` y `granel_id` → ok; sin ninguno → falla el check; iniciar ese envasado → `SIN_TANQUE`; `crear_granel_stock` → `para_envasar`, origen stock; en tanque ocupado → `TANQUE_OCUPADO`; desde planta → `NO_AUTORIZADO`; un envasado sobre la fabricación de stock se inicia y al finalizar cierra la fabricación; `v_tiempos_estandar` no cambia con una de stock; planta no puede insertar en `consumibles`.
- [ ] Generar all.sql → controlador corre → FAIL. Implementar. → PASS (todos los archivos). Commit `feat(db): envasados sin tanque, consumibles y granel de stock (017)`.

### Task 2: RPC de documento, consumibles y reglas de edición

**Files:** Modify migración 017 (sección 2. RPC); Modify `supabase/tests/envasado_documento.test.sql`.

**Interfaces / Produces:**
- `crear_envasado_documento(p_env jsonb, p_consumibles jsonb) returns jsonb` → `{ok:true, id}`. `p_env` keys: `fabricacion_id` (nullable), `granel_id`, `presentacion_id`, `cantidad`, `lote`, `codigo`, `descripcion`, `litros_granel`, `etiqueta_id` (nullable). `p_consumibles = [{codigo, descripcion, cantidad}]`, orden = posición. Solo panel. Si `fabricacion_id` no null: fabricación abierta (`cola`,`fabricando`,`pausada`,`en_control`,`para_envasar`) → si no `TRANSICION_INVALIDA`; su `producto_id` = `granel_id` → si no `GRANEL_DISTINTO`. Cantidad ≤ 0 → `DATOS_INVALIDOS`. Todo o nada.
- `crear_fraccionado_documento(p_frac jsonb, p_consumibles jsonb) returns jsonb` → `{ok:true, id}`. `p_frac` keys: `producto_id` (nullable), `presentacion_id` (nullable), `cantidad`, `lote`, `codigo`, `descripcion`, `etiqueta_id`; `tipo = 'polvo'`.
- `cargar_consumible(p_id uuid, p_lote text, p_empleado_id uuid default null) returns jsonb` → `{ok:true}`. Mismo esquema que `cargar_mp` de 014 (rol, operaria activa, bloqueo de la tarea, `NO_PARTICIPA`), pero la tarea (envasado o fraccionado) debe estar en `activo` o `pausado`; lote vacío → guarda null.
- Trigger `before update` `envasados_validar_edicion`: si cambia `cantidad` o `presentacion_id` con `old.estado in ('finalizado','cancelado')` → `NO_EDITABLE`; si cambia `fabricacion_id` con `old.estado <> 'cola'` → `TANQUE_EN_USO`; destino no abierto → `TRANSICION_INVALIDA`; `producto_id` del destino ≠ `coalesce(new.granel_id, producto de la fabricación vieja)` → `GRANEL_DISTINTO`; asignar `fabricacion_id null` → `SIN_TANQUE`. Los errores del trigger se lanzan como `raise exception` con `errcode 'PC001'`, `message` = código (el cliente ya mapea mensajes de PostgREST; verificar en `src/lib/errores.ts` cómo llega y ajustar el mapeo si hace falta). El trigger no debe disparar cuando `accion()` cambia estado/inicio/fin (solo mira las columnas listadas).
- Grants: `granel_id`, `lote`, `codigo`, `descripcion` también en insert/update de envasados para el alta manual (`codigo`, `lote` en fraccionados ya está `lote`; agregar `codigo`).

- [ ] Tests: crear documento con 3 consumibles → envasado + 3 filas en orden; consumible con cantidad 0 → nada creado; fabricación de otro granel → `GRANEL_DISTINTO`; fabricación finalizada → `TRANSICION_INVALIDA`; esperando (`fabricacion_id null`) → ok, no aparece en `v_tareas`; fraccionado documento ok; `cargar_consumible` en envasado activo por operaria participante → ok con `cargado_por`; no participante → `NO_PARTICIPA`; en `cola` → `TRANSICION_INVALIDA`; finalizar envasado sin lotes de consumibles → ok; editar cantidad en `activo` → ok y evento `editar`; en `finalizado` → `NO_EDITABLE`; cambiar tanque en `activo` → `TANQUE_EN_USO`; asignar tanque a uno esperando → ok y aparece en `v_tareas`; a fabricación de otro granel → `GRANEL_DISTINTO`; Review Focus 2.
- [ ] FAIL → implementar → PASS. Commit `feat(db): crear desde documento, cargar_consumible y reglas de edición`.

### Task 3: Vistas

**Files:** Modify migración 017 (sección 3. Vistas); Modify `supabase/tests/envasado_documento.test.sql`, `supabase/tests/vistas.test.sql` si hace falta.

**Produces:**
- `v_flujo`: envasados con `left join` a fabricación/tanque; producto = `coalesce(producto de la fabricación, granel)`; `descripcion` = `v.descripcion`; `listo` false sin fabricación. Al final: `lote_doc text` (envasado `v.lote`, fraccionado `x.lote`, fabricación null), `granel_id uuid`.
- `v_tareas`: envasado sigue con `join` (excluye esperando); `descripcion` = `v.descripcion`. Al final: `lote_doc text`, `consumibles_total int`, `consumibles_con_lote int` (fabricación 0/0).
- `v_historial`: envasados con `left join`; al final `lote_doc text`, `consumibles jsonb` (`[{codigo, descripcion, cantidad, lote, cargado_nombre, cargado_at}]` en orden; `'[]'` en fabricación), `origen text` (fabricación: `f.origen`; resto null).
- `revisar_alertas` (copiar la de 016) sin cambios de lógica salvo que no falle con envasados sin fabricación (verificar joins).

- [ ] Tests: envasado esperando aparece en `v_flujo` con `tanque_codigo` null y su granel; no en `v_tareas`; `consumibles_total/consumibles_con_lote` = 3/1; `v_historial.consumibles` con el lote y nombre; `origen = 'stock'` en historial; `revisar_alertas()` corre sin error con un esperando.
- [ ] FAIL → implementar → PASS. Commit `feat(db): vistas con envasados del documento y consumibles`.

### Task 4: Parser `envasadoPdf.ts`

**Files:** Create `src/domain/envasadoPdf.ts`, `src/domain/envasadoPdf.test.ts`, fixtures en `src/domain/__fixtures__/` (fragmentos JSON inventados, mismo formato que los de `formulaPdf.test.ts`); Modify `src/domain/formulaPdf.ts` solo para exportar lo que haga falta reutilizar (`agruparPorFila`, lectura de lote/fecha y emparejado de renglones) sin cambiar su comportamiento.

**Produces:**
```ts
export type Consumible = { codigo: string; descripcion: string; cantidad: number }
export type BloqueDocumento = {
  tipo: 'envasado' | 'fraccionado'
  granel: { codigo: string; nombre: string; litros: number } | null // null en fraccionado
  producto: { codigo: string; descripcion: string; cantidad: number }
  presentacion: string | null // nombre normalizado tipo '1.5L', '500g' o null
  consumibles: Consumible[]
}
export type DocumentoEnvasado = { lote: string; fecha: string; bloques: BloqueDocumento[] }
export function tipoDeHoja(fr: Fragmento[]): 'formula' | 'envasado' | null
export function leerEnvasados(fr: Fragmento[]): { ok: true; documentos: DocumentoEnvasado[] } | { ok: false; error: string }
export function presentacionDe(descripcion: string): string | null
```
Reglas del spec (§Formato). `presentacionDe`: `x 1.5 L`→`1.5L`, `x 5 L`→`5L`, `x 10 L`→`10L`, `x 1/2 Kg`→`500g`, `x 1/4 kg`→`250g`, `x 500 grs.`→`500g`, `x 1 Kg`→`1kg`, `x 900g`→`900g`; sin patrón → null. Bloque sin cierre al final de la tabla → se descarta.

- [ ] Tests: hoja de 3 bloques (F9 con litros `(1,800.000)` → 1800; consumibles; cantidades de los tres bloques; presentaciones); hoja de fraccionado sin F (MP + pote + etiqueta en consumibles, granel null); descripción partida en dos renglones; dos comprobantes en un PDF; `tipoDeHoja` de una fórmula (fixture existente) → `'formula'` y `leerEnvasados` de una fórmula → error; `presentacionDe` tabla de casos; Review Focus 3.
- [ ] FAIL → implementar → PASS. Commit `feat(pdf): leer hojas de envasado y fraccionado`.

### Task 5: Cliente, dominio y errores

**Files:** `src/lib/database.types.ts`, `src/lib/errores.ts` (+test), `src/panel/datosOrden.ts`, `src/domain/ordenes.ts` (+test), `src/lib/datosConsumibles.ts` (nuevo), `src/lib/acciones.ts` (+test), `src/domain/flujo.ts` (+test).

**Produces:**
- Tipos de tablas/vistas/RPC nuevas en `database.types.ts`.
- `crearEnvasadoDocumento(env: NuevoEnvasadoDocumento, consumibles: Consumible[]): Promise<Resultado<{ id: string }>>`, `crearFraccionadoDocumento(frac: NuevoFraccionadoDocumento, consumibles: Consumible[])`, `crearGranelStock(d: { tanque_id; producto_id; litros; lote })`, `editarEnvasado(id: string, cambios: Partial<{ cantidad: number; presentacion_id: string; fabricacion_id: string }>)` en `datosOrden.ts`.
- `DatosOrden` suma `lotesDocumento: string[]` (lotes de envasados/fraccionados existentes) y `fabricacionesAbiertas` con `producto_id` y litros sin asignar (si no está ya).
- `validarEnvasadoDocumento(d, ctx)` en `ordenes.ts`: presentación y cantidad > 0 obligatorias; tanque opcional.
- `cargarConsumiblesDe(entidad, id)` y `guardarConsumible(id, lote, empleadoId)` (en `datosConsumibles.ts` / `acciones.ts`, mismo patrón que `cargarMpDe`/`guardarMp`).
- `flujo.ts`: `esperandoFabricacion(f: FilaFlujo): boolean` (envasado con `fabricacion_id` null); `columnaFlujo` no los pone en ninguna columna (nueva columna lógica `'esperando'` fuera de `COLUMNAS`, o filtrados antes de agrupar — elegir y testear); `kpisFlujo` no los cuenta.
- Mensajes para los 4 códigos nuevos.

- [ ] Tests unitarios de cada función nueva (incluido mapeo de errores del trigger) → FAIL → implementar → PASS. Commit `feat(cliente): datos y dominio de envasado por documento`.

### Task 6: Panel — subir PDF de envasado/fraccionado

**Files:** Create `src/panel/SubirEnvasado.tsx` (+ `subirEnvasado.test.tsx`); Modify `src/panel/NuevaOrden.tsx`, `src/panel/SubirFormula.tsx` (detección de tipo y salto de pestaña), `src/panel/panel.css`.

**Produces:** `SubirEnvasado({ datos, tipo: 'envasado' | 'fraccionado', onCreadas, onAlgunaCreada, onOtroTipo })`, mismo patrón que `SubirFormula` (tarjetas, estado `pendiente|creando|creada`, «Crear todas» secuencial, botón deshabilitado mientras crea). Tarjeta de envasado: producto terminado, presentación (select preseleccionado), cantidad, etiquetado, granel (match por `productos.codigo` y luego nombre como en la fórmula; si no, select), selector de tanque con las 3 opciones del spec (una sola fabricación abierta del granel → preseleccionada; «Granel de stock…» abre mini-form tanque libre + litros que llama `crearGranelStock` y deja seleccionada la nueva fabricación), consumibles en `<details>`. Fraccionado: sin tanque. Bloques del tipo contrario al de la pestaña no se muestran (se avisa cuántos se omitieron). Aviso de lote duplicado con confirmación. Aviso de litros excedidos (reusar lógica de `NuevaOrden`).

- [ ] Tests: 3 tarjetas con presentaciones preseleccionadas; una fabricación abierta del granel → tanque preseleccionado; dos → sin preselección; esperando → crea con `fabricacion_id null`; granel de stock → llama `crearGranelStock` y luego `crearEnvasadoDocumento` con ese id; lote duplicado → aviso y no crea hasta confirmar; doble click no duplica; fórmula subida en Envasado → `onOtroTipo('fabricacion')` con el texto exacto; hoja de envasado en Fabricación → `onOtroTipo('envasado')`.
- [ ] FAIL → implementar → PASS. Commit `feat(panel): crear envasados y fraccionados desde el PDF`.

### Task 7: Panel — editar envasados y «Esperando fabricación»

**Files:** Create `src/panel/EditarEnvasado.tsx` (+test), `src/panel/EsperandoFabricacion.tsx` (+test); Modify `src/panel/Flujo.tsx`, `src/panel/TarjetaFlujo.tsx`, `src/panel/DetalleTanque.tsx`, `src/panel/datosTanque.ts` si lista envasados.

**Produces:** Botón «Editar» en envasados no terminados (flujo y detalle de tanque) → diálogo con cantidad, presentación y tanque (tanque solo habilitado en `cola`; opciones = fabricaciones abiertas del mismo granel); muestra el error de la base en el diálogo. Sección «Esperando fabricación» en el flujo (si hay alguno): agrupada por granel, cada envasado con producto terminado, cantidad, lote y «Asignar tanque» (mismo diálogo, solo tanque).

- [ ] Tests: editar cantidad llama `editarEnvasado` con `{cantidad}`; tanque deshabilitado en `activo`; error `TANQUE_EN_USO` visible; sección aparece solo con esperando y agrupa por granel; asignar llama `editarEnvasado` con `{fabricacion_id}`; las tarjetas esperando no aparecen en columnas ni KPIs.
- [ ] FAIL → implementar → PASS. Commit `feat(panel): editar envasados y asignar los que esperan fabricación`.

### Task 8: Tablet — consumibles y datos del documento

**Files:** Create `src/planta/ChecklistConsumibles.tsx` (+test; componente propio: solo lote, sin «pesado», reutiliza `crearColaPorFila` y el patrón de guardado de `ChecklistMp`); Modify `src/planta/MisTareas.tsx`, `src/planta/TarjetaTarea.tsx`, `src/domain/tareas.ts` (`tituloTarea` usa `descripcion` del envasado si existe) (+tests).

**Produces:** En envasado/fraccionado activo o pausado con `consumibles_total > 0`: checklist de consumibles (lote editable, ✓ si tiene lote, nombre de quien cargó); nunca bloquea finalizar. Título de tarea: «Limpiador Prueba x 1.5 L · 600» y lote del documento visible.

- [ ] Tests: guarda lote con la operaria; vacío borra; ✓ con lote; sin lote no muestra error; finalizar habilitado con consumibles sin lote; título con descripción.
- [ ] FAIL → implementar → PASS. Commit `feat(planta): consumibles opcionales en envasado y fraccionado`.

### Task 9: Historial

**Files:** Modify `src/panel/historial/Historial.tsx`, `src/domain/historial.ts`, `src/domain/csv.ts` (+tests).

**Produces:** Detalle de envasado/fraccionado muestra lote del documento y consumibles con lote, quién y cuándo; fabricación de stock muestra «Granel de stock»; envasado sin tanque muestra «—» en tanque; CSV suma columnas `lote_doc` y `consumibles` (texto `codigo: lote; …`).

- [ ] Tests → FAIL → implementar → PASS. Commit `feat(historial): documento y consumibles`.

### Task 10: DEMO y e2e

**Files:** `src/demo/{catalogo,motor,simulador,fetchDemo}.ts` (+tests), `e2e/nueva-orden.spec.ts` o `e2e/demo.spec.ts`, `e2e/fixtures/` (PDF inventado generado con el script).

**Produces:** El simulador soporta columnas y RPC nuevas (`crear_*_documento`, `crear_granel_stock`, `cargar_consumible`, update de envasados con las reglas del trigger, `consumibles` en vistas). E2E en la demo: subir PDF inventado de envasado → tarjeta con tanque sugerido → crear → en tablet iniciar, cargar un lote de consumible, finalizar → la fabricación se cierra.

- [ ] Tests → FAIL → implementar → PASS (`npx playwright test --workers=1`). Commit `feat(demo): envasado desde PDF en el simulador`.

### Task 11: Verificación final y publicación (con OK del usuario)

- [ ] Vitest completo, `npx tsc -b`, `npm run build`, Playwright `--workers=1`, all.sql con todos los archivos SQL → todo verde.
- [ ] Revisión final de la rama.
- [ ] Con OK del usuario: aplicar 017 → verificar en la base (columnas, tabla, funciones) → merge a main → push → deploy (`gh` con `alechiesasubatir-bit`, volver a `achiesa77-ctrl`). Actualizar memoria.
