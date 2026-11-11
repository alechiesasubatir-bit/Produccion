# Varias operarias por orden, traspasos, vencimiento compartido y etiquetas — diseño

Fecha: 2026-11-11 · Migración: 014 (requiere 013 aplicada antes)

## Objetivo

1. Varias operarias pueden trabajar a la vez en una misma orden (fabricación, envasado, fraccionado) y entrar o salir de ella (intercambio).
2. En envasado y fraccionado, cada operaria declara **su** cantidad envasada (L o kg) al salir; las que siguen la declaran al finalizar. Total = suma. La encargada controla y puede corregir.
3. En fabricación, el aporte de cada una son las MP que marcó (`fabricacion_mp.cargado_por`, ya existe); no declara cantidad.
4. La participación de cada operaria queda en el historial.
5. El vencimiento de la fabricación lo puede cargar/cambiar la operaria (tablet) o la encargada (panel); vale el último, el historial registra quién.
6. Etiquetado: Sí/No + elegir una etiqueta de un catálogo nuevo; lo define la encargada al crear la orden.

## 1. Base de datos (migración 014)

### Tabla `produccion.participaciones`

| columna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| entidad | text | `fabricacion` \| `envasado` \| `fraccionado` |
| entidad_id | uuid | id de la orden (sin FK, como `eventos`) |
| empleado_id | uuid not null | FK `operarias(empleado_id)` |
| desde | timestamptz not null default now() | |
| hasta | timestamptz null | null = sigue en la orden |
| cantidad | numeric null, > 0 | solo envasado/fraccionado; obligatoria al cerrar |
| unidad | text null | `L` \| `kg` |
| cantidad_corregida | numeric null, > 0 | solo panel |
| corregida_por | uuid null | `auth.users` |
| corregida_at | timestamptz null | |

- Índice único parcial `(entidad, entidad_id, empleado_id) where hasta is null`: una operaria no puede estar abierta dos veces en la misma orden. Si sale y vuelve, se crea otra fila.
- Índices por `(entidad, entidad_id)` y por `empleado_id`.
- RLS: lectura para panel y planta; escritura solo vía RPC (`security definer`).
- Realtime: agregar a la publicación (no tiene datos sensibles).

### `eventos.accion`

El check suma `sumarse`, `salir`, `corregir`. `datos` lleva `{cantidad, unidad}` en salir/finalizar, `{participacion_id, antes, despues}` en corregir, `{vencimiento: {antes, despues}}` en editar de vencimiento.

### `accion()`: firma nueva

`accion(p_entidad, p_id, p_accion, p_empleado_id, p_pin, p_cantidades jsonb default null)`

- `p_cantidades` = `[{empleado_id, cantidad, unidad}, …]`. Se usa en `salir` (un elemento, el de quien sale) y en `finalizar` de envasado/fraccionado (uno por cada participación abierta).
- La firma vieja se elimina (`drop function`) y se crea la nueva. `p_pin` se mantiene ignorado.

| acción | estados válidos | efecto en participaciones |
|---|---|---|
| iniciar | cola | abre la de `p_empleado_id` (si viene) |
| sumarse | en curso / pausada (`fabricando`, `pausada`, `activo`, `pausado`) | abre la de `p_empleado_id`; error `YA_PARTICIPA` si ya está abierta; en envasado, `OPERARIA_OCUPADA` si ya está en otro envasado abierto (misma regla que iniciar) |
| salir | en curso / pausada | cierra la de `p_empleado_id`. Envasado/fraccionado: exige cantidad > 0 (`CANTIDAD_REQUERIDA`). Error `ULTIMA_OPERARIA` si es la única abierta. Error `NO_PARTICIPA` si no estaba |
| pausar / reanudar | como hoy | ninguno (pausa la orden entera) |
| finalizar | como hoy | cierra todas las abiertas. Envasado/fraccionado desde planta: exige una cantidad por cada abierta (`CANTIDAD_REQUERIDA`). Desde el panel puede finalizar sin cantidades: quedan cerradas con `cantidad null` («Falta declarar») y la encargada las carga con `corregir_cantidad` |
| cancelar | como hoy (solo panel) | cierra todas las abiertas sin cantidad |

- Desde planta, pausar/reanudar/finalizar exigen que `p_empleado_id` tenga participación abierta (`NO_PARTICIPA`), salvo órdenes sin ninguna participación abierta (migradas sin operaria o iniciadas desde el panel), donde vale cualquier operaria activa y se le abre la participación.
- `sumarse` y `salir` no cambian el estado de la orden; generan su evento.
- `iniciar` sigue llenando `operaria_id` / `operaria_1` (quién la tomó) por compatibilidad.
- Cierre automático de fabricación al terminar sus envasados (010): cierra también las participaciones abiertas de la fabricación.

### `cargar_mp()`

Desde planta acepta a cualquier operaria con participación abierta en la fabricación (o cualquiera activa si no hay ninguna abierta). `cargado_por = p_empleado_id`.

### `corregir_cantidad(p_participacion_id, p_cantidad)`

Solo panel. Guarda `cantidad_corregida`, `corregida_por = auth.uid()`, `corregida_at`; evento `corregir`. Solo participaciones cerradas (con cantidad declarada o con `cantidad null`, para completar lo que faltó declarar).

### `set_vencimiento(p_fab_id, p_fecha, p_empleado_id)`

Panel o planta (planta: operaria con participación abierta en esa fabricación). Fabricación no finalizada/cancelada. Actualiza `vencimiento` y deja el evento `editar` con `{vencimiento: {antes, despues}}` y `empleado_id`. El panel también sigue pudiendo editar la columna directamente (trigger de 007 ya registra `editar`).

### Etiquetas

- Tabla `produccion.etiquetas (id uuid pk, nombre text not null unique, activo boolean not null default true, created_at)`. RLS: lectura panel y planta, escritura panel (como presentaciones).
- `envasados.etiqueta_id`, `fraccionados.etiqueta_id`: uuid null FK `etiquetas`. null = no se etiqueta. Grants de insert/update para el panel.
- Trigger: no se puede asignar una etiqueta inactiva (`ETIQUETA_INACTIVA`).
- `etiquetado` (texto) queda para órdenes viejas; no se escribe más.

### Vistas

- `v_tareas`, `v_flujo`: agregan `operarias jsonb` = `[{empleado_id, nombre, desde}]` de las participaciones abiertas, y `etiqueta` (nombre) para envasado/fraccionado. Se mantienen `operaria_1`/`operaria_2` y `producto_tipo` al final (agregar columnas siempre al final para `create or replace view`).
- `v_historial`: agrega `participaciones jsonb` = `[{empleado_id, nombre, desde, hasta, cantidad, unidad, cantidad_corregida}]` (todas, abiertas y cerradas).
- Minutos por operaria: tramo `desde`–`hasta` (o `now()`) menos la superposición con las pausas de la orden (de `eventos`).

### Migración de datos

Para cada orden en curso — fabricaciones `fabricando`/`pausada`, envasados y fraccionados `activo`/`pausado` (no `cola` ni `para_envasar`) — con `operaria_id` / `operaria_1` / `operaria_2` no nulos: insertar participación abierta con `desde = inicio`. Las finalizadas no se migran (el historial viejo sigue mostrando `operaria_1`/`operaria_2`).

## 2. Tablet de planta

- **Mis tareas** en tres grupos:
  1. *Mías*: con participación abierta; cada tarjeta muestra "Con: …" (resto del equipo).
  2. *En curso — sumarme*: en curso o pausadas donde no participa; botón **Sumarme** con confirmación.
  3. *Disponibles*: en cola, **Tomar** (como hoy).
- Acciones en una tarea mía: Pausar/Reanudar, **Salir de la orden**, Finalizar.
  - Salir (envasado/fraccionado): teclado numérico "¿Cuánto envasaste?" + selector L/kg (por defecto kg si `producto_tipo = 'polvo'`, si no L) → confirmar. Fabricación: solo confirmación ("Tus MP cargadas quedan registradas a tu nombre").
  - Si es la única: Salir deshabilitado con aviso "Sos la última: pausá o finalizá".
  - Finalizar (envasado/fraccionado): un campo de cantidad por cada operaria abierta, con nombre; todos obligatorios; mismo selector de unidad.
- **Vencimiento** en tarjetas de fabricación propias: "Vence: dd/mm/aaaa ✎" o "Cargar vencimiento" → selector de fecha → `set_vencimiento`.
- **Etiqueta** (solo lectura) en envasado/fraccionado: "Etiqueta: X" o "Sin etiquetar".
- **Checklist MP**: cualquier operaria de la fabricación marca; cada renglón muestra quién lo marcó.
- Nuevos códigos de error con mensaje amable: `YA_PARTICIPA`, `NO_PARTICIPA`, `ULTIMA_OPERARIA`, `CANTIDAD_REQUERIDA`, `ETIQUETA_INACTIVA`.
- DEMO: el simulador implementa sumarse/salir/finalizar con cantidades, vencimiento y etiquetas.

## 3. Panel

- **Nueva orden** (envasado y fraccionado): "Etiquetado: Sí / No"; con Sí, desplegable de etiquetas activas, obligatorio.
- **Configuración → Etiquetas**: alta, edición y activar/desactivar con `EditorCatalogo` (como Presentaciones). Inactivas no se ofrecen al crear órdenes, pero se muestran en las viejas.
- **Detalle de orden**: sección *Operarias* (Operaria · Desde · Hasta/"sigue" · Declaró · Corregido) con botón **Corregir** por cantidad declarada (muestra "~~120 L~~ → 115 L · corregido por X hh:mm"). Debajo: total declarado (usa corregida si hay) y, en envasado, el esperado `cantidad × presentación` en ámbar si no coincide. En fabricación la columna es *MP cargadas* (renglones marcados por cada una). Vencimiento editable.
- **Flujo y Monitor**: las tarjetas muestran todas las operarias activas.
- **Vista Tablet**: sale gratis (reusa los componentes de planta).

## 4. Historial y KPIs

- Cada orden muestra todas las participaciones (tramo y cantidad efectiva).
- El filtro por operaria incluye las órdenes donde participó.
- Línea de tiempo con los eventos nuevos: sumarse, salir (con cantidad), corregir (antes → después), cambio de vencimiento (con quién).
- KPIs por orden sin cambios; tiempos por operaria desde participaciones menos pausas.

## 5. Pruebas

- pgTAP (fixtures existentes): sumarse; doble sumarse → `YA_PARTICIPA`; salir con/sin cantidad; última no puede salir; finalizar con 2 abiertas exige ambas cantidades; finalizar cierra todas; cancelar cierra todas; corregir solo panel y deja evento; `set_vencimiento` desde planta deja evento con empleado; etiqueta inactiva rechazada; migración de abiertas; `cargar_mp` por segunda operaria.
- Vitest: clasificación de tareas (Mías / Sumarme / Disponibles), Salir con teclado, Finalizar multi-campo, vencimiento, Sí/No de etiqueta, catálogo Etiquetas, corregir y totales, historial con participaciones.
- e2e de demo y planta actualizados.

## 6. Publicación

1. Aplicar migración 013 (no está en la base al 2026-11-11) — con OK del usuario.
2. Aplicar 014 — con OK del usuario.
3. Push a main + `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main`.

## Fuera de alcance

- Control para liberación (pH, densidad, perfume, visual) y envasado/fraccionado desde documento: siguen pendientes aparte.
- Repartir una pausa por operaria (la pausa es de la orden).
