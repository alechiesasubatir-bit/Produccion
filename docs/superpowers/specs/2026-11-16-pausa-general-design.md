# Pausa General y Arranque — diseño

Fecha: 2026-11-16 · Migración: 018

## Objetivo

Al terminar el día quedan órdenes en marcha (fabricaciones, envasados, fraccionados). La encargada
aprieta **Pausa General** en el panel: todas las órdenes se pausan, cada operaria sale de su orden con
los L/kg que envasó (los carga la encargada) y la planta queda bloqueada. Al día siguiente aprieta
**Arranque**: elige qué órdenes siguen y con qué operarias (las de ayer vienen marcadas; puede
cambiarlas) y todo se reanuda junto.

Criterios de éxito:

- Un solo paso para cerrar el día y uno para abrirlo, atómicos (o se aplica todo o nada).
- La noche no suma a los tiempos efectivos ni a los tiempos por operaria.
- No saltan alertas durante la noche ni al día siguiente por las horas en pausa.
- Las cantidades de cada operaria quedan en sus participaciones, como en «salir».

## 1. Base de datos (migración 018)

### Tabla `produccion.pausas_generales`

| columna | tipo | nota |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| inicio | timestamptz not null default now() | |
| fin | timestamptz null | null = sigue abierta |
| iniciada_por | uuid not null | `auth.users` |
| terminada_por | uuid null | `auth.users` |

- Índice único parcial `((true)) where fin is null`: una sola pausa general abierta.
- RLS: lectura panel y planta; escritura solo vía RPC (`security definer`).
- Realtime: agregar a la publicación (la tablet escucha para mostrar/quitar el bloqueo).

### Tabla `produccion.pausa_general_ordenes`

| columna | tipo | nota |
|---|---|---|
| pausa_id | uuid not null | FK `pausas_generales` |
| entidad | text not null | `fabricacion` \| `envasado` \| `fraccionado` |
| entidad_id | uuid not null | sin FK, como `eventos` |
| estaba | text not null | `en_curso` \| `pausada` (estado antes de la pausa general) |
| operarias | uuid[] not null default '{}' | participaciones abiertas al momento de pausar |

- PK `(pausa_id, entidad, entidad_id)`. RLS: lectura panel; escritura vía RPC.

### `pausa_general(p_cantidades jsonb) returns jsonb`

Solo panel (`NO_AUTORIZADO` si no). Mismo contrato que `accion()`: errores de negocio como
`{ok:false, codigo, detalle}`; éxito `{ok:true, pausa_id, ordenes}`.

- `p_cantidades` = `[{entidad, entidad_id, empleado_id, cantidad, unidad}, …]`.
- Si hay una pausa general abierta → `PAUSA_GENERAL_ACTIVA`.
- Alcance: fabricaciones `fabricando`/`pausada`, envasados y fraccionados `activo`/`pausado`.
  Se bloquean con `for update` en orden fijo (entidad, id) para no generar deadlocks.
- Si no hay ninguna orden en alcance → `SIN_ORDENES`.
- Por cada orden:
  1. Inserta la fila en `pausa_general_ordenes` (`estaba`, `operarias` = participaciones abiertas).
  2. Si está en curso: pasa a `pausada`/`pausado` y deja evento `pausar` con
     `datos = {pausa_general: <pausa_id>}`.
  3. Cierra cada participación abierta (`hasta = now()`) y deja evento `salir` con
     `datos = {pausa_general: <pausa_id>, cantidad, unidad}`.
  4. Envasado/fraccionado: exige una cantidad > 0 por participación abierta; si falta alguna,
     `CANTIDAD_REQUERIDA` con `detalle` = nombre de la operaria y de la orden. Unidad `L` | `kg`.
     Fabricación: no lleva cantidad (se ignoran las que vengan).
- Todo en una transacción: ante cualquier error no queda nada aplicado.

### `arranque_general(p_ordenes jsonb) returns jsonb`

Solo panel. `p_ordenes` = `[{entidad, entidad_id, empleados: [uuid, …]}, …]`.

- Sin pausa general abierta → `SIN_PAUSA_GENERAL`.
- Cada orden de la lista debe estar en `pausa_general_ordenes` de la pausa abierta y seguir
  `pausada`/`pausado` (si la encargada la finalizó o canceló en la noche → `TRANSICION_INVALIDA`
  con detalle de la orden). Lista vacía es válida: levanta la pausa sin reanudar nada.
- Cada orden necesita al menos una operaria (`SIN_OPERARIAS`), todas activas (`OPERARIA_INACTIVA`).
- Una operaria no puede quedar en dos envasados a la vez: ni entre las órdenes de la lista ni con
  un envasado `activo` fuera de ella (`OPERARIA_OCUPADA`, misma regla y detalle que `accion()`).
- Por cada orden: evento `reanudar` con `datos = {pausa_general: <pausa_id>}`, pasa a
  `fabricando`/`activo`, abre una participación por operaria con evento `sumarse`
  (`datos = {pausa_general: <pausa_id>}`).
- Cierra la pausa (`fin = now()`, `terminada_por = auth.uid()`). Las órdenes que no vinieron en la
  lista quedan pausadas, como cualquier pausa normal.

### Bloqueo de planta

Con una pausa general abierta, desde planta (`not es_panel()`):

- `accion()` devuelve `PAUSA_GENERAL` (con `detalle` = hora de inicio, `HH24:MI` Montevideo) para
  cualquier acción.
- `cargar_mp()` y `cargar_consumible()` también devuelven `PAUSA_GENERAL`.
- `registrar_control()` no se bloquea (el control no es producción).
- El panel no tiene bloqueo: la encargada puede finalizar, cancelar o reanudar a mano una orden.

### Alertas (`revisar_alertas`)

- Con una pausa general abierta no se crean alertas nuevas; el borrado de las resueltas sigue igual.
- `exceso_9h` pasa a medir **minutos efectivos** (sin pausas) en vez de la hora de reloj:
  - envasado: `v_tiempos_efectivos.min_efectivos > 540`;
  - fabricación: minutos desde `greatest(inicio, último rechazar)` menos los tramos de pausa que caen
    después de ese punto `> 540` (mantiene la regla de 016: el reloj arranca en el último rechazo).
- `pausa_larga` sin cambios (tras el Arranque las órdenes reanudadas ya no están pausadas; las no
  elegidas sí cuentan como pausa larga, que es correcto).

### Tiempos

`v_tiempos_efectivos` no cambia: los eventos `pausar`/`reanudar` de la pausa general son tramos de
pausa normales. Los minutos por operaria salen de las participaciones, que se cierran a la noche y se
abren en el Arranque.

### Vistas

- `v_historial` y la línea de tiempo ya leen `eventos`: el front distingue los de pausa general por
  `datos.pausa_general`.
- `v_pausa_general` (o lectura directa de la tabla): pausa abierta con `inicio` y nombre de quien la
  inició, para la franja de aviso.

## 2. Panel

- **Botón en la barra superior** (`encabezado` de `PanelApp`, a la derecha): grande, «Pausa
  General». Con una pausa abierta cambia a «Arranque» (otro color) y debajo «en pausa desde HH:MM».
- **Diálogo Pausa General**:
  - Lista las órdenes en alcance agrupadas (Fabricación / Envasado / Fraccionado) con producto y
    tanque o presentación, y si estaba en curso o ya pausada.
  - Envasado/fraccionado: un campo de cantidad por operaria abierta con selector L/kg (por defecto
    kg si `producto_tipo = 'polvo'`, si no L); todos obligatorios. Reutiliza la lógica de
    `DeclararCantidad`.
  - Fabricación: solo listada, con sus operarias.
  - Sin órdenes en alcance: «No hay órdenes en marcha» y botón deshabilitado.
  - Confirmar → `pausa_general`; errores con mensaje amable.
- **Diálogo Arranque**:
  - Lee `pausa_general_ordenes` de la pausa abierta (órdenes que siguen pausadas; las que se
    finalizaron/cancelaron en la noche se muestran como «cerrada en la noche», sin casilla).
  - Por orden: casilla «Reanudar» (marcada si `estaba = en_curso`, desmarcada si `pausada`),
    operarias de ayer marcadas y un selector para sumar otras activas.
  - Valida en el front: al menos una operaria por orden marcada; misma operaria en dos envasados.
  - Confirmar → `arranque_general`.
- **Franja de aviso** «Planta en pausa general desde HH:MM» en el panel y en el Monitor.
- **Historial**: en la línea de tiempo, los eventos con `pausa_general` se muestran como «Pausa
  general» / «Arranque» (y las salidas/entradas de operarias de esos momentos se agrupan bajo ese
  rótulo).

## 3. Tablet de planta

- Escucha `pausas_generales` en tiempo real.
- Con pausa abierta: franja «Planta en pausa general desde HH:MM — la encargada la levanta con
  Arranque» y todos los botones de acción, checklist de MP y consumibles deshabilitados.
- Si igual llega `PAUSA_GENERAL` del servidor (carrera), mensaje amable.

## 4. DEMO

El simulador implementa `pausa_general` y `arranque_general` con las mismas reglas y la tablet de la
demo se bloquea igual.

## 5. Errores nuevos

`PAUSA_GENERAL`, `PAUSA_GENERAL_ACTIVA`, `SIN_PAUSA_GENERAL`, `SIN_ORDENES`, `SIN_OPERARIAS`, con
texto en `mensajeError`.

## 6. Pruebas

- pgTAP (fixtures existentes):
  - pausa general pausa las en curso, deja `pausar` y `salir` con cantidades, guarda
    `pausa_general_ordenes` con `estaba` y operarias;
  - falta una cantidad → `CANTIDAD_REQUERIDA` y no queda nada aplicado;
  - segunda pausa → `PAUSA_GENERAL_ACTIVA`; sin órdenes → `SIN_ORDENES`; planta → `NO_AUTORIZADO`;
  - con pausa abierta, `accion()`, `cargar_mp()` y `cargar_consumible()` desde planta →
    `PAUSA_GENERAL`; desde el panel funcionan;
  - arranque reanuda las elegidas con operarias nuevas, deja las otras pausadas y cierra la pausa;
    orden sin operarias → `SIN_OPERARIAS`; operaria en dos envasados → `OPERARIA_OCUPADA`;
    orden cerrada en la noche → `TRANSICION_INVALIDA`;
  - `v_tiempos_efectivos` descuenta la noche; `revisar_alertas` no crea alertas durante la pausa y
    `exceso_9h` no salta por las horas en pausa.
- Vitest: diálogo Pausa General (campos obligatorios, unidad por defecto, sin órdenes), diálogo
  Arranque (prellenado, validaciones), botón que cambia según la pausa, tablet bloqueada, historial,
  simulador de la demo.

## 7. Publicación

1. Aplicar 018 con OK del usuario (es producción).
2. Recién después: push a main + `gh workflow run deploy.yml -R alechiesasubatir-bit/Produccion --ref main`
   (nunca en paralelo con la migración).

## Fuera de alcance

- Pausa general automática por horario.
- Pausar solo un sector o tipo de orden.
- Órdenes en cola, en control o listas para envasar: no se tocan.
