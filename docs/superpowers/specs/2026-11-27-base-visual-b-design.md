# Base visual B («editorial industrial») — diseño

Fecha: 2026-11-27 · Subproyecto 1 de 3 del salto gráfico de ProdControl.

## Contexto y objetivo

ProdControl tiene que **vender**: mostrarse a dirección, clientes o visitas y verse como un producto de primera, parejo en todas las pantallas (panel, tablet, monitor, demo). La identidad se **evoluciona**, no se rehace: se conservan el naranja de Subatir, el tono industrial y Fira Sans / Fira Code.

El salto se parte en tres subproyectos, cada uno con su spec, plan y deploy:

1. **Base visual B** (este documento): lenguaje visual nuevo aplicado a toda la app, sin cambiar lógica.
2. **Planta (sinóptico en fila)**: reemplaza la pestaña Tanques. Spec aparte.
3. **Flujo (línea de proceso)**: reemplaza el kanban del Flujo y define qué muestra el Monitor. Spec aparte.

La base va primero porque 2 y 3 se construyen sobre sus tokens y componentes.

## Decisiones tomadas con el usuario

- Dirección **B «editorial industrial»**: clara y precisa, números grandes y livianos, grilla fuerte, naranja solo donde importa.
- **Todo en claro**, sin modo oscuro (tampoco el Monitor).
- **Barra superior blanca** con línea inferior; la pestaña activa se subraya en naranja. Aplica a panel, tablet (`planta-barra`), monitor y demo.
- **Se mantienen** las animaciones decorativas de hoy: barrido de luz y punto que late en los chips en curso, respiro con el color del producto en las tarjetas en uso, destello del vidrio, ola y burbujas en los tanques.
- **Se suman** cuatro animaciones:
  - **(2) Etapa actual en marcha**: en la barra segmentada de etapas, una luz naranja recorre el segmento en curso.
  - **(3) Pulso «en vivo»**: punto verde con onda en la barra superior; sin conexión se apaga y pasa a gris.
  - **(7) Cambio de estado con salto**: cuando una orden cambia de etapa, su chip y su tarjeta dan un pequeño salto y cambian de color.
  - **(8) Tarjetas que se levantan**: al pasar el mouse se elevan con sombra; los botones principales tienen el destello que cruza (existe hoy solo en `.boton`).
- **Descartadas**: cifras que cuentan, entrada en cascada, gráficos que se dibujan, producto que fluye por cañerías (tampoco se usará en 2 y 3).

## Lenguaje visual

- **Fondo** gris frío liso (`--papel` ≈ `#f4f5f7`); superficies blancas con borde `--linea` y radio 8px.
- **Cifras**: Fira Code, peso 300, tracking negativo. Escala `--cifra-xl` (≈30px, KPIs), `--cifra-l` (≈22px), `--cifra-m` (≈16px). Tabulares siempre.
- **Franja de KPIs**: una sola caja blanca dividida en celdas por líneas verticales (no tarjetas sueltas). Rótulo chico gris arriba, cifra, variación en verde/rojo abajo.
- **Tablas**: encabezados en versalitas grises de 10px, filas separadas por línea muy tenue, cifras alineadas a la derecha.
- **Chips de estado**: planos, versalitas de 10px en negrita, un color por etapa (cola gris, fabricando azul, control índigo, envasando naranja, fraccionado ámbar, pausado rojo, terminada verde, libre punteado). El barrido y el punto que late siguen en los chips en curso.
- **Barra segmentada de etapas**: segmentos de 4–6px; hechos en `--tinta`, actual en `--marca` con la luz que la recorre, pendientes en `--linea`.
- **Botones**: principal `--marca-oscuro` con letra blanca (AA), secundario blanco con borde, fantasma sin borde. En la tablet, los mismos tokens con tamaño grande.
- **Naranja**: solo botón principal, pestaña activa, etapa actual y marcas de selección.
- **Tanque**: el de hoy (`Tanque.tsx`, con ola y burbujas) con los colores de los tokens nuevos.

## Arquitectura del CSS

Hoy: 5.576 líneas de CSS, `panel.css` con 3.862 líneas y secciones que pisan a otras («Color: el naranja…», «vida: color y movimiento», «Tanques: pared de fichas + carrusel…»), y 127 colores hex escritos a mano fuera de los tokens.

Después:

| Archivo | Contenido |
|---|---|
| `src/ui/tokens.css` | Primitivos y semánticos con los valores de B. Se **conservan los nombres** semánticos actuales (`--papel`, `--tinta`, `--marca`, `--barra`…) para no tocar el TSX. Se agregan `--barra-linea`, escala `--cifra-*`, y por etapa `--etapa-<estado>-fondo/-tinta/-linea`. |
| `src/ui/componentes.css` (nuevo) | Botón, chip, caja, franja de KPIs, tabla, modal, barra de etapas. Única definición de cada uno. |
| `src/ui/movimiento.css` (nuevo) | Todos los `@keyframes` y reglas de animación (las de hoy y las cuatro nuevas) y el bloque `prefers-reduced-motion`. |
| `src/ui/app.css` | Layout general, encabezado, pantallas centradas, avisos (sin animaciones ni componentes). |
| `src/panel/estilos/*.css` (nuevo) | `panel.css` partido por área: `flujo`, `tanques`, `kpis`, `historial`, `alertas`, `config`, `monitor`, `pdf`, `pausa`, `demo`, `modal-panel`. Cada sección que pisaba a otra se funde en su área; las reglas muertas se borran. |
| `src/planta/planta.css` | Tablet, con tokens nuevos y sin hex sueltos. |

Reglas:

- Ningún color hex fuera de `tokens.css` (salvo el color de producto que viene de datos vía `--producto`).
- Los nombres de clase existentes se mantienen salvo que una sección fundida los vuelva redundantes; el TSX se toca lo mínimo.
- Flujo y Tanques reciben solo la base (se reemplazan en los subproyectos 2 y 3): no se invierte en rediseñarlos.

## Componentes React

- **`<Etapas>`** (`src/ui/Etapas.tsx`, nuevo): barra segmentada. Props: lista de etapas y la actual. La usan la tarjeta del Flujo, el detalle de la orden y la tablet donde hoy se muestra la etapa en texto o con barra propia.
- **Animación 7**: hook `useCambio(valor)` (`src/ui/useCambio.ts`, nuevo) que guarda el valor anterior en un `useRef` y devuelve un contador que sube solo cuando el valor cambia **después** del primer render. El chip de estado y la tarjeta usan ese contador como `key` de un envoltorio interno y agregan la clase `salto` cuando es mayor que 0: al cambiar de etapa el envoltorio se vuelve a montar y la animación corre una vez; en la primera carga (contador 0) no salta nada. El estado del componente no se pierde porque la `key` está en el envoltorio, no en el componente.
- **Animación 3**: `<PulsoVivo>` en la barra superior, alimentado por `useEnLinea` (`src/lib/useEnLinea.ts`), el mismo hook que hoy muestra la banda «sin conexión».
- `Tanque.tsx`: sin cambios de estructura; solo colores vía tokens.

## Accesibilidad

- Contraste AA (4,5:1) para texto de chips, cifras grises y rótulos; el botón principal sigue en `--marca-oscuro`.
- Todas las animaciones bajo `prefers-reduced-motion: reduce` quedan quietas (como hoy).
- El pulso «en vivo» no es la única señal de conexión: la banda «sin conexión» sigue.

## Fuera de alcance

Lógica, datos, Supabase, pantallas nuevas (Planta, línea de proceso, contenido del Monitor), modo oscuro.

## Pruebas y verificación

- `npm run typecheck`, `npm test` (vitest) y `npm run e2e` (Playwright) pasan sin cambios de lógica; los tests que busquen clases renombradas se ajustan.
- Test de `<Etapas>` (segmentos hechos/actual/pendientes) y de la animación 7 (no salta en el primer render, sí al cambiar de estado).
- Capturas antes/después de cada pestaña de la demo (`/demo`): Flujo, Tanques, KPIs, Historial, Alertas, Config, Monitor, Tablet; y `/planta`.
- Chequeo de contraste de los pares de tokens nuevos.
- `grep` sin hex fuera de `tokens.css`.

## Entrega

Rama `base-visual-b`, un commit por paso (tokens → componentes/movimiento → cada área), demo revisada por el usuario y deploy a GitHub Pages al final.
