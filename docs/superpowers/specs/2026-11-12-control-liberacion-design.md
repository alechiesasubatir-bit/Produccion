# Control para liberación — diseño

Fecha: 2026-11-12 · Migración: 015

## Objetivo

Antes de envasar, una encargada controla cada fabricación terminada (pH, densidad, perfume, aspecto visual) y la **aprueba** (queda lista para envasar) o la **rechaza** (vuelve a fabricando para corregirla). Cada intento queda registrado con su firma.

Decisiones del usuario:
- Estado nuevo `en_control`; no se puede envasar hasta aprobar.
- pH y densidad se anotan tal cual (sin rangos); la encargada decide. En productos **polvo** no se miden (quedan vacíos).
- Perfume y visual: OK / No OK; comentario obligatorio si No OK.
- Rechazo → vuelve a `fabricando`; al finalizarla otra vez vuelve a control (intento 2, 3…). Se guardan todos los intentos.
- Se carga desde el panel (firma = usuario logueado) o desde la tablet (firma = usuario del panel elegido de una lista, sin verificación).

## 1. Base de datos (migración 015)

### Estado

- `fabricaciones.estado` admite `en_control`. El índice único de tanque con orden abierta (`fabricaciones_tanque_abierta_uk`) incluye `en_control` (el tanque sigue ocupado).
- `accion()`:
  - `finalizar` desde `fabricando` → `en_control` (antes `para_envasar`). Se mantiene `MP_INCOMPLETA` y el cierre de participaciones.
  - `cancelar` válido también en `en_control` (solo panel, como siempre).
  - `iniciar` de un envasado cuyo tanque no está en `para_envasar` sigue dando `TANQUE_NO_LISTO` (cubre `en_control`).
  - `finalizar` con merma (`para_envasar` → `finalizada`, panel) no cambia.
- Fabricaciones ya en `para_envasar` al aplicar la migración no cambian (se consideran liberadas, sin control registrado).
- `eventos.accion` admite además `aprobar` y `rechazar`.

### Tabla `produccion.controles`

| columna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| fabricacion_id | uuid not null | FK fabricaciones |
| intento | int not null | 1, 2, 3… por fabricación; único (fabricacion_id, intento) |
| ph | numeric null | 0–14; null en polvo |
| densidad | numeric null | > 0; null en polvo |
| perfume_ok | boolean not null | |
| perfume_comentario | text null | obligatorio si perfume_ok = false |
| visual_ok | boolean not null | |
| visual_comentario | text null | obligatorio si visual_ok = false |
| observaciones | text null | |
| resultado | text not null | `aprobado` \| `rechazado` |
| firmado_por | uuid not null | auth.users (perfiles.id) |
| firmado_nombre | text not null | nombre del perfil al firmar (snapshot) |
| origen | text not null | `panel` \| `tablet` |
| created_at | timestamptz not null default now() | |

RLS: lectura panel y planta; escritura solo vía RPC. Agregada a `supabase_realtime`.

### `registrar_control(p_fab_id uuid, p_ph numeric, p_densidad numeric, p_perfume_ok boolean, p_perfume_comentario text, p_visual_ok boolean, p_visual_comentario text, p_observaciones text, p_resultado text, p_firmante uuid default null) returns jsonb`

- Rol: panel o planta (`NO_AUTORIZADO` si no).
- Firma: panel → `auth.uid()`; planta → `p_firmante` obligatorio y debe ser un perfil activo con `rol = 'admin'` o `rol_produccion = 'panel'` (`NO_AUTORIZADO` si no).
- Fabricación: `NO_ENCONTRADO` si no existe; `TRANSICION_INVALIDA` si no está `en_control`. Bloquea la fila (`for update`).
- Datos (`DATOS_INVALIDOS`): `p_resultado` en (aprobado, rechazado); `perfume_ok`/`visual_ok` no nulos; comentario no vacío si el respectivo es false; si el producto **no** es polvo: pH y densidad obligatorios, pH entre 0 y 14, densidad > 0; si es polvo: se guardan null aunque vengan.
- Inserta el control con `intento = max + 1`, `firmado_nombre` del perfil, `origen` (`panel` si es_panel(), si no `tablet`).
- Aprobado → estado `para_envasar`, evento `aprobar`. Rechazado → estado `fabricando`, evento `rechazar`. Eventos con `usuario_id` = firmante y `datos {control_id, intento, motivo}` (motivo = comentarios No OK + observaciones, para el recorrido).
- Devuelve `{ok:true, intento}` o `{ok:false, codigo, detalle}`.

### `listar_liberadoras() returns table (id uuid, nombre text)`

Perfiles activos con `rol = 'admin'` o `rol_produccion = 'panel'`, ordenados por nombre. Ejecutable por panel y planta (security definer); vacío/`NO_AUTORIZADO` para otros.

### Vistas

- `v_flujo`, `v_tanque_estado`, `v_tareas`: incluyen fabricaciones `en_control` (v_tareas para la tablet). Columna nueva al final: `control_intento int` (intento que se está por hacer = cantidad de controles + 1) y `control_rechazo text` (motivo del último control si fue rechazado y la fabricación volvió a fabricando; null si no).
- `v_historial`: columna nueva al final `controles jsonb` (`[{intento, resultado, ph, densidad, perfume_ok, perfume_comentario, visual_ok, visual_comentario, observaciones, firmado_nombre, origen, created_at}]`, por intento) en fabricaciones; `'[]'` en el resto.
- `v_tiempos_efectivos` / KPIs: sin cambios (el tiempo en control queda calculable: evento finalizar → aprobar).

## 2. Tablet de planta

- Grupo nuevo **«En control»** (debajo de «Mías»): fabricaciones `en_control` con tanque, producto, lote, «Intento N» y botón **Controlar**.
- Controlar:
  1. **«¿Quién controla?»**: lista de `listar_liberadoras()` con nombres grandes (sin PIN).
  2. Formulario: pH y densidad (teclado decimal; ocultos si `producto_tipo = 'polvo'`), Perfume OK/No OK, Visual OK/No OK, comentario obligatorio si No OK, Observaciones opcional.
  3. **Aprobar** (confirma «¿Aprobar el control? El tanque queda listo para envasar.»; si hay No OK, el texto avisa «Hay puntos No OK. ¿Aprobar igual?») y **Rechazar** (confirma «La fabricación vuelve a fabricando.»).
- Fabricación rechazada: aparece en «En curso — sumarme» con **«Rechazado: …»** (motivo del último control).
- Errores del servidor con su texto, como el resto de la tablet.

## 3. Panel

- **Flujo**: chip «En control» (color propio) y botón **Controlar**; Monitor solo el chip.
- **Tanques**: estado «En control» con color propio.
- **Controlar** desde el panel: mismo formulario sin «¿Quién controla?» (firma el usuario logueado), en diálogo desde Flujo o el detalle del tanque.
- **Detalle del tanque**: sección **«Control»** plegada (`<details>`) con cada intento: N.º, resultado (verde/rojo), pH, densidad, perfume, visual con comentarios, observaciones, quién firmó, hora y origen.
- **Historial**: columna **«Control»** en fabricaciones («Aprobado (María, 2.º intento)», «—» en órdenes previas). CSV: pH, densidad, perfume, visual, liberó y fecha del control aprobado (en la primera fila de la orden). Recorrido: «María aprobó el control», «María rechazó el control: perfume No OK (muy suave)».

## 4. Pruebas y publicación

- pgTAP: finalizar → en_control; envasado sobre tanque en control → TANQUE_NO_LISTO; aprobar desde panel (firma uid) y planta (firmante válido / inválido / inactivo → NO_AUTORIZADO); aprobado → para_envasar + evento; rechazado → fabricando + evento, refinalizar → intento 2; No OK sin comentario, pH 15, densidad 0 → DATOS_INVALIDOS; polvo sin pH/densidad OK; controlar fuera de en_control → TRANSICION_INVALIDA; listar_liberadoras; vistas con en_control y controles. Actualizar tests que esperaban para_envasar tras finalizar.
- Vitest: tablet (grupo, quién controla, formulario, polvo, confirmaciones, aviso No OK, rechazo visible), panel (formulario, sección Control, chip/color), historial (columna, CSV, recorrido).
- e2e: planta controla y aprueba; demo muestra una fabricación en control. DEMO: el simulador controla (aprueba casi siempre, rechaza a veces).
- Publicación en bloque: 015 → app → recargar tablets, panel y monitor (la app vieja no conoce `en_control`).

## Fuera de alcance

- Rangos de pH/densidad por producto.
- PIN o contraseña para firmar desde la tablet.
- Tiempo en control en los KPIs.
- Envasado/fraccionado desde documento.
