# ProdControl — Rediseño + Supabase

**Fecha:** 2026-10-20 · **Estado:** diseño aprobado por secciones, pendiente revisión de la spec escrita
**Origen:** `C:\Users\alech\Downloads\ProdControl_2026-10-20.html` (app actual, HTML único + Firebase RTDB)

---

## 1. Objetivo

Rehacer ProdControl (control de producción de Subatir: fabricación en tanques, envasado y
fraccionado) como una app nueva con una identidad visual y de movimiento fuerte, reemplazando el
JSON único de Firebase por tablas reales en Supabase y tomando a las operarias de los empleados de
la plataforma.

**Éxito significa:**
- Las operarias registran inicio/pausa/fin desde una tablet en planta con su nombre + PIN, en pocos toques.
- La encargada ve el flujo de producción completo en vivo en la PC, con KPIs, historial y configuración.
- Cada acción queda registrada (quién, qué, cuándo) y los tiempos efectivos descuentan pausas.
- Se conservan todas las funciones de la app actual (ver §9).

### Lo que dijo el usuario vs. supuestos
| Dicho por el usuario | Supuesto (validado en las secciones) |
|---|---|
| Rediseño con fuerte gráfica y animación | Mismas funciones, sin features nuevas grandes |
| Tablas en Supabase "produccion" de la org subatirapps-a11y | → Es el **entorno productivo**: esquema `produccion` dentro del proyecto **plataforma** |
| Empleados desde la plataforma | Las operarias son **siempre** empleados de `core` |
| Tablet en planta + PC de la encargada | Una app, dos rutas |
| Publicar en GitHub Pages | Build estático Vite |

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Superficies | Tablet en planta (`/planta`) + PC encargada (`/panel`) |
| Identidad | Encargada/admin: usuario Supabase con módulo `produccion`. Tablet: usuario-dispositivo siempre logueado. Operarias: elegir avatar + **PIN de 4 dígitos** |
| Backend | Proyecto Supabase **plataforma**, esquema nuevo `produccion`; empleados leídos de `core` |
| Acceso para construir | MCP de Supabase |
| Stack | Vite + React + TypeScript, Motion (Framer) para UI, animación de tanques en SVG/CSS |
| Publicación | GitHub Pages vía GitHub Actions |
| Dirección visual | **B · Laboratorio claro** con burbujas; color de líquido por producto (configurable) |
| Layout PC | **PC-B · Tablero de flujo (kanban)**; la pared de tanques con panel lateral queda como vista "Tanques" |
| Layout tablet | **TAB-A · Primero la persona** |
| Extras conservados | QR por tanque, exportación CSV |

Prototipos de referencia (interactivos, datos falsos):
`.superpowers/brainstorm/115-1792523762/content/pc-prototipo.html` y `tablet-prototipo.html`.

---

## 3. Arquitectura

```
GitHub Pages (estático)
└── ProdControl  ── Vite + React + TS
     ├── /planta    → tablet (TAB-A)      ─┐
     └── /panel     → PC encargada (PC-B) ─┤  supabase-js (anon key + RLS)
                                           ▼
Supabase · proyecto PLATAFORMA
 ├── auth.users + profiles       (login encargada/admin y usuario-dispositivo)
 ├── core.empleados (existente)  ← solo lectura
 └── produccion.*  (NUEVO)
      ├── tablas + vistas + RPC
      ├── Realtime → tablet y PC
      └── Edge Function escanear-hoja
```

- **Una app, dos rutas.** `/panel` exige `profiles.modules` con `produccion` (rol `admin` o encargada).
  `/planta` exige un usuario-dispositivo (p. ej. `tablet-planta-1@…`) marcado como dispositivo en `profiles`.
- **Acciones de operarias solo por RPC.** `produccion.accion(tipo, id, accion, empleado_id, pin)` valida el
  PIN (hash `pgcrypto`/`crypt`), la transición de estado y las reglas de negocio, escribe el cambio y el
  evento en **una transacción**. La tablet nunca lee `pin_hash` ni escribe tablas directamente.
- **Realtime:** suscripción a `fabricaciones`, `envasados`, `fraccionados` y `alertas`; fallback de
  polling cada 15 s si el canal cae.
- **Historial basado en eventos** (`produccion.eventos`), del cual se derivan tiempos, KPIs y calendario.
- **Arranque limpio:** no se migran los datos de prueba de Firebase.

> **A verificar con el MCP antes de crear nada:** nombre/columnas reales de la tabla de empleados en `core`
> (nombre, foto, activo, sector), estructura de `profiles` (`role`, `modules`), funciones RLS existentes
> (helpers de rol/módulo) y esquemas expuestos en la API (agregar `produccion` a *Exposed schemas*).
> La spec usa `core.empleados` como nombre provisorio.

---

## 4. Modelo de datos — esquema `produccion`

### 4.1 Catálogos (edita la encargada)
| tabla | columnas |
|---|---|
| `productos` | `id uuid pk`, `nombre text unique`, `color text` (hex del líquido), `tipo text` (`liquido`/`denso`/`polvo`), `litros_hora_std numeric null`, `activo bool`, `created_at` |
| `presentaciones` | `id`, `nombre text unique` (`5L`, `500g`…), `litros_equiv numeric`, `activo` |
| `tanques` | `id`, `codigo text unique` (`T-01`), `capacidad_l numeric`, `orden int`, `activo` |
| `operarias` | `empleado_id pk → core.empleados`, `categoria text`, `color_avatar text`, `pin_hash text`, `pin_intentos int`, `pin_bloqueado_hasta timestamptz`, `activo` |

### 4.2 Trabajo
| tabla | columnas clave |
|---|---|
| `fabricaciones` | `id`, `tanque_id`, `producto_id`, `litros`, `lote`, `estado` ∈ `cola · fabricando · pausada · para_envasar · finalizada · cancelada`, `operaria_id`, `inicio`, `fin`, `creado_por`, `created_at` |
| `envasados` | `id`, `fabricacion_id`, `presentacion_id`, `cantidad int`, `etiquetado text`, `operaria_1`, `operaria_2 null`, `estado` ∈ `cola · activo · pausado · finalizado · cancelado`, `inicio`, `fin`, `creado_por` |
| `fraccionados` | `id`, `tipo`, `descripcion`, `producto_id null`, `presentacion_id null`, `cantidad`, `lote`, `etiquetado`, `operaria_id`, `estado` ∈ `cola · activo · pausado · finalizado · cancelado`, `inicio`, `fin`, `creado_por` |
| `eventos` | `id bigserial`, `entidad` (`fabricacion`/`envasado`/`fraccionado`), `entidad_id`, `accion` (`crear`/`iniciar`/`pausar`/`reanudar`/`finalizar`/`cancelar`/`editar`), `empleado_id null`, `usuario_id` (auth.uid), `dispositivo text null`, `at timestamptz`, `datos jsonb` |
| `alertas` | `id`, `tipo` (`exceso_9h`/`desvio_estandar`), `entidad`, `entidad_id`, `texto`, `creada`, `leida bool`, `pospuesta_hasta timestamptz null` |

### 4.3 Vistas
- `v_tanque_estado` — por tanque: estado (`libre`/`cola`/`fabricando`/`pausada`/`para_envasar`/`envasando`/`cola_env`), fabricación activa, litros restantes (litros − Σ envasados finalizados × litros_equiv).
- `v_tiempos_efectivos` — por tarea: minutos brutos, minutos en pausa, minutos efectivos (desde `eventos`).
- `v_kpis_dia`, `v_ranking_operarias`, `v_tiempos_estandar` (litros/hora por producto), `v_historial_mensual`.

### 4.4 Reglas en la base
- Transiciones válidas solo vía `produccion.accion`; cualquier otra combinación → error con mensaje legible.
- Un tanque no puede tener dos fabricaciones en estados `cola..para_envasar` (índice único parcial).
- Una operaria no puede estar en dos envasados `activo` a la vez (validado en la RPC, con lock de fila).
- Al finalizar un envasado, si los litros restantes del tanque ≤ 0, la fabricación pasa a `finalizada` automáticamente.
- PIN: 5 intentos fallidos → bloqueo 1 min (`pin_bloqueado_hasta`).
- Alertas `exceso_9h`: función `produccion.revisar_alertas()` ejecutada por `pg_cron` cada 10 min.

### 4.5 RLS
| quién | lectura | escritura |
|---|---|---|
| encargada/admin (módulo `produccion`) | todo `produccion.*` excepto `operarias.pin_hash` | catálogos, crear/editar/cancelar órdenes, alertas, `set_pin()` |
| usuario-dispositivo | órdenes, catálogos, vistas, operarias (sin `pin_hash`, vía vista `v_operarias`) | **solo** RPC `accion()` |
| resto | nada | nada |

RPCs: `accion(...)`, `set_pin(empleado_id, pin)` (solo encargada/admin), `revisar_alertas()` (cron).

---

## 5. Pantallas

### 5.1 PC · `/panel` (navegación superior)
| vista | contenido |
|---|---|
| **Flujo** (inicio) | Kanban: Cola → Fabricando → Para envasar → Envasando → Fraccionado → Terminadas hoy. Tarjeta con mini-tanque, operaria, avance; vuelo FLIP entre columnas en tiempo real. KPIs compactos en la barra. Botón **+ Nueva orden** (fabricación / envasado / fraccionado, con "Escanear hoja") |
| **Tanques** | Pared de tanques grandes; clic → panel lateral con tanque grande, datos, recorrido, acciones de encargada, **QR del tanque** |
| **Historial** | Tabla densa ordenable/filtrable + vista mensual (calendario día/semana/mes); **exportar CSV** |
| **KPIs** | Operaciones, productos, ranking de operarias, tiempos vs. estándar; **exportar CSV** |
| **Alertas** | Lista con marcar leída / posponer; sonido opcional |
| **Configuración** | Productos (selector de color con vista previa del tanque), presentaciones, tanques, operarias (vincular empleado de `core`, categoría, color, resetear PIN) |

### 5.2 Tablet · `/planta` (TAB-A)
1. **¿Quién trabaja?** — grilla de operarias activas; punto verde (trabajando) / naranja (pausada).
2. **PIN** — teclado de 4 dígitos; error = sacudida; 5 fallos = bloqueo 1 min.
3. **Mis tareas** + **Disponibles para tomar** — panel de acción con botones grandes y cronómetro.
4. **Confirmación** — check dibujado + estallido del color del producto → vuelve a Mis tareas.
5. **Cierre de sesión automático** a los 30 s sin interacción (anillo visible).
- `?tanque=T-03` (desde el QR): tras el PIN, las tareas de ese tanque aparecen primero.
- Las órdenes se crean en la PC; la tablet solo toma/inicia/pausa/reanuda/finaliza.

---

## 6. Sistema visual y de movimiento

- **Paleta:** papel `#f5f6f2`, papel-2 `#eceee6`, tarjeta `#ffffff`, tinta `#0f172a`, líneas `#e3e5dc`. Chips de estado: fabricando verde, envasando celeste, fraccionado ámbar, pausa rojo suave, cola gris, terminada violeta.
- **Tipografía:** Fraunces (títulos, itálica), Geist (UI), Geist Mono (números/códigos).
- **`<Tanque>`** (componente central): SVG con dos olas desfasadas, nivel animado, reflejo de vidrio, marcas de nivel; burbujas según estado (fabricando muchas, envasando pocas, pausada ninguna y ola detenida); contorno punteado si está libre/reservado. Color desde `productos.color`.
- **Motion:** `layout`/`layoutId` para FLIP de tarjetas, transiciones de vista, hoja de PIN, contadores de KPI animados, entrada escalonada de la grilla de operarias.
- **Accesibilidad de movimiento:** con `prefers-reduced-motion` no hay olas, burbujas ni vuelos; los cambios son instantáneos.
- Tamaños táctiles en tablet ≥ 64 px de alto para acciones primarias.

---

## 7. Errores y conectividad

- **Tablet sin conexión:** banda "Sin conexión", acciones **deshabilitadas** (no se encolan). Al reconectar → resincroniza.
- **RPC rechaza** (tarea ya finalizada, operaria ocupada, PIN bloqueado): mensaje humano con el motivo y refresco de la lista.
- **Realtime caído:** reconexión automática + polling 15 s mientras tanto.
- **Lecturas > 1000 filas:** helper de paginación como en Compras (`supabase-config.js`).
- **Escaneo:** si la Edge Function falla o devuelve JSON inválido, el formulario queda editable a mano con aviso.

---

## 8. Pruebas y publicación

- **SQL:** tests de `accion()` y reglas (PIN incorrecto/bloqueo, transición inválida, operaria ocupada, cierre automático del tanque, tiempos con pausas) en una rama de Supabase o base de prueba.
- **Front:** Vitest (lógica pura: nivel del tanque, proyecciones, formateos); Playwright (flujo tablet persona→PIN→iniciar→finalizar; flujo PC crear orden→aparece en kanban).
- **Verificación visual** en navegador real a tamaño tablet (1180×820) y PC (1440×900).
- **Repo** `SubatirApps/Produccion`; GitHub Actions compila y publica a Pages en push a `main`; `base` de Vite y `404.html` para rutas SPA.
- **Migraciones** en `supabase/migrations/`, aplicadas con el MCP.
- **Config:** URL + anon key de plataforma en `.env` (públicas por diseño). Clave de IA solo en la Edge Function.

---

## 9. Paridad con la app actual

| Función actual | En la nueva |
|---|---|
| Dashboard de tanques (SVG) | Vista Tanques + mini-tanques en el kanban |
| Fabricación / Envasado / Fraccionado (cola/activo/pausado/historial) | Kanban + tablet + Historial |
| Envasado con 2 operarias, varios envasados por tanque | `envasados.operaria_1/2`, `fabricacion_id` |
| Proyecciones de tiempo (`calcProyFab/Env`) | Mismas fórmulas usando `v_tiempos_estandar` |
| Historial + vista mensual + calendario | Historial |
| KPIs (operaciones, productos, ranking), tiempos estándar | KPIs |
| Notificaciones, alertas > 9 h, sonido, posponer | Alertas + `pg_cron` |
| Escaneo de hoja Macrosoft con IA | Edge Function `escanear-hoja` (mismos prompts) |
| Config: operarias, productos, presentaciones, tanques, usuarios | Configuración (usuarios → `profiles` de plataforma) |
| QR por tanque | Panel de tanque → QR a `/planta?tanque=…` |
| Exportar CSV | Historial y KPIs |
| Login por PIN (admin/encargada) | Reemplazado por login Supabase (§2) |

## 10. Fuera de alcance
Migración de datos de Firebase · cola offline · app nativa · funciones nuevas no listadas en §9.
