# Subir PDF de fórmula + checklist de materias primas — Diseño

**Fecha:** 2026-11-06 · **Estado:** aprobado en chat, pendiente de revisión escrita
**Reemplaza:** el «Escanear hoja» con IA (spec 2026-10-20 §7, plan 4 Tasks 6-7).

## 1. Objetivo

Las órdenes de fabricación se crean subiendo el PDF «Movimientos de Produccion · Fabrica Produccion» que genera el programa interno (ejemplo: `BACTIPRO.pdf`). La operaria, al fabricar, completa un checklist con el **lote** de cada materia prima y tilda **pesado**; sin eso no puede finalizar. Queda como registro de trazabilidad.

**Lo dijo el usuario:** el PDF puede traer una o varias fórmulas; se toma lote, vencimiento, MP (código y cantidad) y el granel (fila F…); los lotes de MP se cargan para que quede un checklist de que se pone todo lo que lleva la fórmula; la operaria los carga en la tablet; pesado se tilda y es obligatorio para avanzar; el vencimiento se carga a mano al subir (en el PDF viene vacío).

**Fuera de alcance (partes siguientes, cada una con su spec):** 2 · Control para liberación (pH, densidad, perfume, visual, firma del encargado). 3 · Documentos de envasado y fraccionado (hacen falta ejemplos).

## 2. Formato del PDF (lo que se lee)

PDF digital con capa de texto (no es imagen). Por fórmula:

| Dato | Dónde | Ejemplo |
|---|---|---|
| Lote | debajo de «LOTE Nº» | `17702` |
| Fecha de la fórmula | debajo de «FECHA» (DD/MM/YYYY) | `21/10/2026` |
| Materias primas | filas de la tabla con cantidad **entre paréntesis** | `900101 · (6.500) · Esencia Floral Prueba x Kg ( MP )` |
| Granel | fila cuyo código es `F` + dígitos, cantidad sin paréntesis | `F8 · 1,000.000 · Bactipro (Granel)` |

- Números: coma = miles, punto = decimal (`1,000.000` → 1000; `(0.300)` → 0.3). Nunca ×1000.
- El texto extraído sale desordenado por columnas: la lectura se hace **por posición** (x/y de cada fragmento de `pdf.js`), agrupando por renglón (y) y asignando columna por x según los encabezados «Código», «Cantidad», «Descripción».
- Descripción del granel: se le quita el sufijo `(Granel)`. Descripción de MP: se guarda tal cual.
- Varias fórmulas: cada bloque «Movimientos de Produccion» (normalmente una página) es una fórmula. Se detecta por cada aparición de «LOTE Nº».
- «Vencimiento», «Tanque destinado», «Lote», «Pesado» del PDF vienen vacíos: se ignoran.

## 3. Panel (PC): Nueva orden › Fabricación

- «Escanear hoja» se reemplaza por **«Subir PDF de fórmula»** (`accept="application/pdf"`).
- `pdf.js` (`pdfjs-dist`, cargado de forma diferida solo al usar el botón) extrae el texto en el navegador; el archivo no se envía a ningún lado.
- Resultado: una **tarjeta por fórmula** con lote, fecha, granel + litros, lista de MP (solo lectura), y campos a completar:
  - **Producto**: se busca por `productos.codigo` = código del granel; si no, por nombre normalizado (función existente `buscarEnCatalogo`). Si no aparece: aviso «No encontré «Bactipro» en productos» y se elige de la lista. Al crear, si el producto elegido no tenía código, se le guarda (así la próxima vez matchea solo).
  - **Tanque** (solo libres, valida capacidad ≥ litros como hoy).
  - **Vencimiento** (fecha, obligatorio, posterior a la fecha de la fórmula).
  - **Operaria** (opcional).
- Botones: **Crear** por tarjeta y **Crear todas**. Cada creación es atómica (fabricación + sus MP) vía RPC. Las que fallan muestran su error y quedan para reintentar; las creadas se marcan.
- Lote repetido: si ya existe una fabricación no cancelada con ese lote, aviso y no se crea (evita subir dos veces el mismo PDF).
- PDF sin texto o sin el formato esperado: aviso «Este PDF no tiene el formato de Movimientos de Produccion. Cargá la orden a mano.» y el formulario manual sigue disponible.
- La carga manual de fabricación (sin PDF) sigue existiendo: se crea sin MP, y el checklist no aplica (no bloquea finalizar). Vencimiento queda opcional en la carga manual.

## 4. Tablet: checklist de MP

- En la tarjeta de una fabricación **en curso** (fabricando o pausada) con MP, se muestra la lista: código, descripción, cantidad, campo **Lote** (texto) y casilla **Pesado**.
- Una MP está completa cuando tiene lote no vacío **y** pesado tildado. Avance visible: «3 de 4 MP».
- Cada cambio se guarda al momento (al salir del campo / al tildar) con la operaria que tiene la tarea; muestra «guardado» o el error.
- **Finalizar** queda deshabilitado mientras falte alguna MP, con el texto «Faltan 2 MP por completar». La base también lo rechaza (no depende solo del front).
- Se pueden corregir lotes mientras la fabricación no esté finalizada.

## 5. Base de datos (migración 011, con OK del usuario: es producción)

```sql
alter table produccion.fabricaciones
  add column vencimiento   date,
  add column fecha_formula date;

alter table produccion.productos add column codigo text unique;

create table produccion.fabricacion_mp (
  id             uuid primary key default gen_random_uuid(),
  fabricacion_id uuid not null references produccion.fabricaciones (id) on delete cascade,
  orden          int  not null,
  codigo         text not null,
  descripcion    text not null,
  cantidad       numeric not null check (cantidad > 0),
  lote           text,
  pesado         boolean not null default false,
  cargado_por    uuid references produccion.operarias (empleado_id),
  cargado_at     timestamptz,
  unique (fabricacion_id, orden)
);
```

- RLS: lectura para panel y planta; sin insert/update directo (todo por RPC).
- `produccion.crear_fabricacion_formula(p_fab jsonb, p_mp jsonb)` — solo panel; inserta fabricación + MP en una transacción; rechaza lote duplicado; devuelve `{ok, id}` o `{ok:false, codigo, detalle}`.
- `produccion.cargar_mp(p_mp_id, p_lote, p_pesado, p_empleado_id, p_pin)` — planta (con PIN, mismo patrón que `accion()`) o panel; solo si la fabricación está `fabricando`/`pausada` y la operaria es la asignada; no lanza errores de negocio, devuelve `{ok:false, codigo, detalle}`.
- `accion('fabricacion', id, 'finalizar')`: si hay MP con `lote` vacío o `pesado = false` → `{ok:false, codigo:'mp_incompleta', detalle:'Faltan N MP'}`.
- `v_tareas` / vista de detalle: exponer `mp_total` y `mp_completas` para la tarjeta.
- `src/lib/database.types.ts` se actualiza a mano.

## 6. Consulta en el panel

En el detalle del tanque / historial de una fabricación: lote, vencimiento y la tabla de MP con lote, pesado, quién y cuándo.

## 7. Limpieza

Se borra `supabase/functions/escanear-hoja`, `EscanearHoja.tsx`, `imagen.ts` (si nadie más lo usa), `escanearHoja()` y los prompts; `domain/escaneo.ts` conserva `aNumero`, `normalizarNombre`, `buscarEnCatalogo`. Se actualizan la demo (`src/demo`) para simular el PDF y el checklist, y los mocks e2e.

## 8. Pruebas

- `domain/formulaPdf.ts` (puro, recibe los fragmentos con posición): test con los fragmentos reales de `BACTIPRO.pdf` → lote 17702, fecha 2026-10-21, granel F8 Bactipro 1000, 4 MP con cantidades 6.5 / 0.3 / 22.5 / 970.7; test con dos fórmulas; test de PDF sin formato → error.
- pgTAP: crear con MP, lote duplicado, `cargar_mp` con PIN incorrecto / operaria ajena / estado inválido, finalizar bloqueado con MP incompleta y permitido al completar, fabricación manual sin MP finaliza normal.
- Componentes: tarjetas por fórmula, Crear todas con un error parcial; tablet: checklist, Finalizar deshabilitado y habilitado.
- e2e: subir `BACTIPRO.pdf` (fixture en `e2e/`) → orden creada; tablet completa MP y finaliza.
