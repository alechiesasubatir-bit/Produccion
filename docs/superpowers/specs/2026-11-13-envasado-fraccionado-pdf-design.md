# Envasado y fraccionado desde PDF — diseño

Fecha: 2026-11-13 · Migración: 017

## Objetivo

La encargada sube la hoja «Movimientos de Produccion — Fabrica Envasado» que genera el programa interno y la app crea los envasados (líquidos y polvos fabricados) o fraccionados (polvos de MP directa) con sus consumibles, en lugar de cargarlos a mano. Durante la producción puede cambiar cantidad, presentación o tanque de cada envasado, quitarlo o agregar otro.

Decisiones del usuario:
- Enfoque A: cada bloque del PDF es un envasado/fraccionado suelto; se agrupan por el lote del documento. Sin entidad «orden».
- Un envasado puede salir de una fabricación en curso, de granel de stock (tanque con granel que no pasó por la app) o quedar «esperando fabricación».
- Tanque: la app sugiere y la encargada confirma. Los «esperando fabricación» los asigna la encargada (no se enganchan solos).
- Cambios a demanda: cantidad, agregar, quitar, cambiar tanque.
- Consumibles: la operaria puede cargar su lote en la tablet; **opcional**, no bloquea finalizar.

## Formato del PDF

Mismo encabezado y grilla que la fórmula (`src/domain/formulaPdf.ts`): «LOTE Nº», «FECHA», tabla Código / Cantidad / Descripción / Lote / Pesado / Deposito, termina en «Tanque destinado» / «Observaciones». Un PDF puede traer varios comprobantes (varios «LOTE»).

La tabla de un comprobante de envasado es una secuencia de **bloques**. Cada bloque:
- (opcional) un renglón `F<n>` con cantidad **entre paréntesis** = granel consumido, en litros/kg (`F9 (900.000) Limpiador Prueba (Granel)`);
- renglones de código numérico entre paréntesis = consumibles (envase, tapa, etiqueta, o la MP en polvos);
- **cierra** con un renglón de código numérico **sin paréntesis** = producto terminado y unidades (`900301 600.000 Limpiador Prueba x 1.5 L`).

Un bloque abarca desde el renglón siguiente al cierre anterior hasta su propio cierre.

Detección del tipo de hoja (por comprobante):
- **Fórmula**: hay un renglón `F<n>` sin paréntesis (se produce granel). Es el formato actual.
- **Envasado**: hay renglones numéricos sin paréntesis (producto terminado) y ningún `F` sin paréntesis.

Clasificación del bloque:
- con renglón `F` → **envasado** (sale de una fabricación; vale para líquidos y polvos fabricados);
- sin `F` → **fraccionado** de MP directa (p. ej. Polvo Prueba: Carga Mineral Prueba + pote + etiqueta).

Presentación: se deduce del nombre del producto terminado (`x 1.5 L` → `1.5L`, `x 5 L` → `5L`, `x 1/2 Kg` → `500g`, `x 500 grs` → `500g`, `x 1 Kg` → `1kg`), comparando con `presentaciones.nombre` normalizado. Sin coincidencia → la encargada la elige.

Granel: el `F<n>` se busca en `productos.codigo`; si no, por nombre (sin «(Granel)»), con el mismo criterio de coincidencia que la fórmula. Sin coincidencia → la encargada lo elige.

## 1. Base de datos (migración 017)

### Envasados
- `fabricacion_id` pasa a **nullable**. `null` = «esperando fabricación».
- Columnas nuevas: `lote text` (lote del documento), `codigo text`, `descripcion text` (producto terminado), `granel_id uuid references productos` (granel requerido; obligatorio si `fabricacion_id` es null), `litros_granel numeric` (referencia del PDF).
- Check: `fabricacion_id is not null or granel_id is not null`.
- Un envasado sin fabricación solo puede estar en `cola` (no se inicia: `accion('iniciar')` da `SIN_TANQUE`). `v_tareas` no lo muestra.
- Al asignar `fabricacion_id`, si `granel_id` está cargado y no coincide con el `producto_id` de la fabricación → error `GRANEL_DISTINTO`.

### Fraccionados
- Columnas nuevas: `codigo text` (producto terminado). `lote`, `descripcion`, `producto_id`, `presentacion_id` ya existen.

### Consumibles (tabla nueva `produccion.consumibles`)
- `id`, `entidad` (`envasado` | `fraccionado`), `entidad_id`, `orden`, `codigo`, `descripcion`, `cantidad numeric > 0`, `lote text`, `cargado_por` (operaria), `cargado_at`. Único `(entidad, entidad_id, orden)`.
- RLS: lectura panel o planta; escritura solo por RPC. En la publicación Realtime.

### Granel de stock
- `fabricaciones.origen text not null default 'formula' check (origen in ('formula', 'stock'))`.
- RPC `crear_granel_stock(p_tanque_id, p_producto_id, p_litros, p_lote)` (solo panel): crea la fabricación directamente en `para_envasar` con `origen = 'stock'`, `inicio = fin = now()`, evento `crear` con `{"stock": true}`. Tanque libre (mismo índice único). No pasa por control. No cuenta para tiempos estándar de fabricación (`v_tiempos_estandar` excluye `origen = 'stock'`); el historial la muestra como «Granel de stock».

### RPCs
- `crear_envasado_documento(p_env jsonb, p_consumibles jsonb)` (solo panel): un envasado + sus consumibles, todo o nada. `p_env = {fabricacion_id|null, granel_id, presentacion_id, cantidad, lote, codigo, descripcion, litros_granel, etiqueta_id}`.
- `crear_fraccionado_documento(p_frac jsonb, p_consumibles jsonb)` (solo panel): ídem para fraccionado (`tipo = 'polvo'`).
- `cargar_consumible(p_id uuid, p_lote text, p_empleado_id uuid)` (planta o panel): guarda/borra el lote; la operaria debe participar de la tarea (mismo criterio que `cargar_mp`).
- Errores de negocio como `{ok:false, codigo, detalle}`.

### Reglas de edición (trigger `before update` en envasados)
El panel sigue editando por update directo (grants de columnas de 005), validado por trigger:
- `cantidad`, `presentacion_id`: permitido en `cola`, `activo`, `pausado`; no en `finalizado`/`cancelado` → `NO_EDITABLE`.
- `fabricacion_id`: solo en `cola` → `TANQUE_EN_USO`; la fabricación destino debe estar abierta (`cola`, `fabricando`, `pausada`, `en_control`, `para_envasar`) y ser del mismo granel.
- Quitar = `cancelar` (sin cambios).
- El trigger de eventos de 007 ya registra `editar` con antes/después.

### Vistas
- `v_flujo`: `descripcion` de envasados = producto terminado; al final `lote_doc`, `granel_id`. Los envasados sin fabricación salen (left join) con `fabricacion_id`/`tanque_codigo` null, producto = su granel, `estado = 'cola'`; el front los muestra como «esperando fabricación».
- `v_tareas`: agrega `lote`, `descripcion`, cantidad de consumibles y cuántos tienen lote; excluye envasados sin fabricación.
- `v_historial`: agrega `lote` del documento y `consumibles` (json con lotes cargados) de envasados y fraccionados.

## 2. Panel

- Nueva orden, pestañas Envasado y Fraccionado: botón «Subir PDF» (mismo componente de lectura que la fórmula). Si la hoja es de otro tipo, avisa y cambia de pestaña.
- Una **tarjeta por bloque**:
  - producto terminado, presentación (editable, preseleccionada), cantidad (editable), etiquetado sí/no;
  - envasado: granel «F9 Limpiador Prueba (Granel) · 900 L» y selector **Tanque**: (1) fabricaciones abiertas de ese granel con litros sin asignar — si hay una sola, preseleccionada; (2) «Granel de stock en un tanque libre…» (mini-form tanque + litros, llama a `crear_granel_stock`); (3) «Esperando fabricación»;
  - consumibles en una lista desplegable de solo lectura.
- Aviso si ya hay envasados/fraccionados con ese lote («Este documento ya se cargó», confirmar). Aviso (no bloquea) si lo asignado supera lo que queda en el tanque.
- «Crear todas», una por una, error en su tarjeta.
- Detalle de tanque / flujo: «Editar» por envasado (cantidad, presentación, tanque, con las reglas de arriba).
- Sección **«Esperando fabricación»** en el flujo: envasados sin tanque agrupados por granel, con «Asignar tanque» (solo fabricaciones abiertas de ese granel).

## 3. Tablet

- Tarjeta de envasado/fraccionado: producto terminado («Limpiador Prueba x 1.5 L · 600») y lote del documento.
- Checklist de consumibles (reusa `ChecklistMp` en modo opcional): carga lote con operaria y hora; con lote = ✓; sin lote no es error; no bloquea finalizar.
- Cambios del panel se ven en vivo (Realtime ya existente + `consumibles`).

## 4. Demo

El simulador (`src/demo`) soporta las RPC y columnas nuevas, con un PDF inventado de envasado en la demo.

## 5. Pruebas

- **Parser** (`envasadoPdf.test.ts`): fixtures generados con `scripts/pdf-desde-fragmentos.mjs` con datos **inventados** (repo público; los PDF reales no se commitean). Casos: 3 bloques líquidos, fraccionado sin F, descripción partida en dos renglones, miles con coma `(1,800.000)`, presentación no reconocida, varios comprobantes por PDF, detección fórmula vs envasado.
- **SQL** (pgTAP): crear desde documento (todo o nada), esperando fabricación no se inicia ni aparece en tareas, asignar tanque (granel distinto, fabricación cerrada), editar según estado, granel de stock (tanque ocupado, no pasa por control, excluido del estándar), `cargar_consumible` (permisos, operaria no participante), finalizar sin lotes de consumibles.
- **UI**: tarjetas y sugerencia de tanque, aviso de lote duplicado, editar envasado, sección esperando, checklist opcional en tablet.
- **E2E (demo)**: subir PDF → asignar → envasar → cierre automático de la fabricación.

## Fuera de alcance

- Que los «esperando fabricación» se enganchen solos.
- Descontar stock de consumibles.
- Leer los campos manuscritos de la hoja (lote, pesado, tanque destinado).
