# Base visual B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar el lenguaje visual B «editorial industrial» a toda la app (panel, tablet, monitor, demo) sin cambiar lógica, conservando las animaciones de hoy y sumando cuatro.

**Architecture:** Tokens con los mismos nombres semánticos y valores nuevos; componentes y animaciones en archivos propios (`componentes.css`, `movimiento.css`); `panel.css` partido primero de forma mecánica (salida idéntica) y después fundido por área. Tres piezas React nuevas: `useCambio`, `<Etapas>`, `<PulsoVivo>`.

**Tech Stack:** React 19, Vite 8, CSS plano con custom properties, Vitest 5 + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-base-visual-b-design.md`

## Global Constraints

- Todo en claro; sin modo oscuro.
- Barra superior blanca con línea inferior, pestaña activa subrayada en `--marca` (panel `.encabezado`, tablet `.planta-barra`, monitor `.monitor-cabecera`).
- Se conservan los nombres semánticos de tokens actuales (`--papel`, `--tinta`, `--tinta-2`, `--apagado`, `--linea`, `--marca`, `--marca-oscuro`, `--barra`…).
- Ningún color hex fuera de `src/ui/tokens.css` (el color de producto entra por `--producto` desde datos).
- Contraste AA (≥ 4,5:1) en texto de chips, rótulos grises y botón principal.
- Se mantienen: barrido + punto que late en chips en curso, respiro en tarjetas en uso, destello/ola/burbujas en tanques. Se suman: luz en la etapa actual, pulso «en vivo», salto al cambiar de estado, tarjetas que se levantan + destello en botones principales. Nada más.
- Todo lo animado queda quieto bajo `prefers-reduced-motion: reduce`.
- Sin cambios de lógica, datos ni Supabase. Flujo y Tanques reciben solo la base.
- Repo público: nada de datos reales en capturas commiteadas (las capturas no se commitean).

## Review Focus

- **Primera carga con muchas órdenes**: ningún chip ni tarjeta salta al abrir una pestaña; solo salta la que cambió de estado en vivo. → test en Task 3.
- **Estado desconocido o cancelado** en `<Etapas>`: no rompe ni muestra una barra mentirosa; no se dibuja. → test en Task 4.
- **Pausado**: la etapa actual sigue marcada en su lugar (fabricando / envasando) aunque el chip diga «Pausado». → test en Task 4.
- **Sin conexión**: el pulso pasa a gris y su texto accesible lo dice; la banda «sin conexión» sigue apareciendo. → test en Task 5.
- **Movimiento reducido**: las animaciones nuevas (luz de etapa, pulso, salto, levantar) quedan dentro del bloque `prefers-reduced-motion`. → test en Task 2.

---

### Task 0: Capturas «antes»

**Files:**
- Create: `e2e/capturas.spec.ts`
- Modify: `.gitignore` (agregar `capturas/`)

**Interfaces:**
- Produces: `CAPTURAS=<carpeta> npx playwright test capturas` guarda PNG de página completa en `capturas/<carpeta>/<nombre>.png`. Sin la variable el spec se saltea (`test.skip`), así no corre en la suite normal.

- [ ] **Step 1:** Escribir `e2e/capturas.spec.ts`: un `test` por vista de la demo — `demo` (Flujo), `demo/tanques`, `demo/kpis`, `demo/monitor`, `demo/tablet` — con viewport 1440×900, espera `networkidle` + 1500 ms (para que el simulador cargue), y `page.screenshot({ fullPage: true, animations: 'disabled' })`. Más una a 820×1180 de `demo/tablet` (`tablet-vertical`). Historial, Alertas y Config no están en la demo: se capturan a mano en Task 9.
- [ ] **Step 2:** Run: `CAPTURAS=antes npx playwright test capturas` → 6 PNG en `capturas/antes/`.
- [ ] **Step 3:** Commit `test(e2e): capturas de la demo para comparar antes/después`.

### Task 1: Tokens B y su contraste

**Files:**
- Modify: `src/ui/tokens.css` (capas 1–3; los `@keyframes`, `.chip*` y el bloque reduced-motion se mueven en Task 2, no acá)
- Create: `src/ui/tokens.test.ts`

**Interfaces:**
- Produces (tokens nuevos que usan Tasks 2–9):
  - `--barra: #fff`, `--barra-linea: var(--linea)`, `--barra-tinta: var(--tinta)`, `--barra-tinta-2: var(--tinta-2)`
  - `--cifra-xl: 30px`, `--cifra-l: 22px`, `--cifra-m: 16px`, `--cifra-peso: 300`, `--cifra-tracking: -0.02em`
  - por etapa `cola | fabricando | control | envasando | fraccionado | pausado | terminada`: `--etapa-<e>-fondo`, `--etapa-<e>-tinta` (y `--etapa-libre-linea`)
  - `--sombra-levantada: 0 14px 28px -14px rgb(15 23 42 / 0.35)`

- [ ] **Step 1: Test de contraste que falla.** `tokens.test.ts` lee `tokens.css` con `fs`, arma un mapa `--nombre → valor` del primer `:root`, resuelve `var(--x)` recursivamente hasta un hex y calcula contraste WCAG. Casos (`it.each`), todos `≥ 4.5`:
  - `--etapa-<e>-tinta` sobre `--etapa-<e>-fondo` para las 7 etapas
  - `--apagado` sobre `--papel` y sobre `--tarjeta`
  - `--boton-tinta` sobre `--boton-fondo`
  - `--barra-tinta-2` sobre `--barra`
- [ ] **Step 2:** Run `npx vitest run src/ui/tokens.test.ts` → FAIL (faltan los tokens `--etapa-*`).
- [ ] **Step 3:** Cambiar valores en `tokens.css`: `--papel: #f4f5f7`, `--papel-2: #eceef2`, `--apagado: #566476` (el `#64748b` no llega a 4,5 sobre `#f4f5f7`), barra blanca como arriba, escala de cifras, `--sombra-levantada`. Etapas (fondo / tinta): cola `#f1f5f9`/`#475569`, fabricando `#dbeafe`/`#1d4ed8`, control `#e0e7ff`/`#3730a3`, envasando `#fff1e6`/`#c2410c`, fraccionado `#fef3c7`/`#92400e`, pausado `#fee2e2`/`#b91c1c`, terminada `#dcfce7`/`#047857`; `--etapa-libre-linea: var(--linea-2)`. Los hex nuevos van como primitivos en la capa 1 y las etapas los referencian.
- [ ] **Step 4:** Run el test → PASS. Run `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5:** Commit `style(tokens): valores de la base B y test de contraste AA`.

### Task 2: componentes.css, movimiento.css y barra blanca

**Files:**
- Create: `src/ui/componentes.css`, `src/ui/movimiento.css`, `src/ui/movimiento.test.ts`
- Modify: `src/ui/tokens.css` (sacar keyframes, `.chip*`, reduced-motion), `src/ui/app.css` (sacar `.boton*` y «vida»; encabezado blanco), `src/App.tsx` o `src/main.tsx` (importar `componentes.css` y `movimiento.css` después de `tokens.css`), `src/planta/planta.css` (`.planta-barra` blanca), sección Monitor de `src/panel/panel.css` (`.monitor-cabecera` blanca)

**Interfaces:**
- Produces clases que usan Tasks 3–9:
  - `.chip`, `.chip-<etapa>` (desde `--etapa-*`), `.chip.en-curso` (barrido + punto, sin cambios de comportamiento)
  - `.boton`, `.boton-sec`, `.boton-fantasma`
  - `.caja` (superficie blanca, borde, radio 8) y `.caja-titulo`
  - `.franja-kpi` > `.franja-kpi-celda` > `.franja-kpi-rotulo` / `.franja-kpi-cifra` / `.franja-kpi-variacion` (`.sube`/`.baja`)
  - `.tabla` (encabezados versalita 10px gris, cifras `.n` a la derecha)
  - `.etapas` > `i` con `.hecha` / `.actual` / (pendiente sin clase); `.actual::after` es la luz (keyframe `avanza`)
  - `.pulso-vivo` (+ `.apagado`), keyframe `onda`
  - `.salto` (keyframe `salto`, una vez, 450 ms)
  - `.levanta` (hover: `translateY(-3px)` + `--sombra-levantada`)
  - El destello de `.boton:not(.boton-sec)` se mueve de `app.css` a `movimiento.css` sin cambios.

- [ ] **Step 1: Test que falla.** `movimiento.test.ts` lee `movimiento.css` y verifica que existan `@keyframes avanza`, `onda`, `salto`, y que dentro del bloque `@media (prefers-reduced-motion: reduce)` aparezcan los selectores `.etapas`, `.pulso-vivo`, `.salto`, `.levanta`.
- [ ] **Step 2:** Run → FAIL (el archivo no existe).
- [ ] **Step 3:** Mover los keyframes y reglas animadas de `tokens.css` y `app.css` a `movimiento.css` (mismo contenido), agregar los cuatro nuevos y extender el bloque reduced-motion. Mover `.chip*` y `.boton*` a `componentes.css` reescritos con tokens (chips: versalitas 10px negrita, fondo/tinta de `--etapa-*`, sin borde de color salvo `libre` punteado). Agregar `.caja`, `.franja-kpi`, `.tabla`, `.etapas`. Encabezados: fondo `--barra`, `border-bottom: 1px solid var(--barra-linea)`, pestaña activa con `border-bottom: 2px solid var(--marca)`.
- [ ] **Step 4:** Run `npx vitest run` y `npm run build` → PASS. `npm run dev` y abrir `/Produccion/demo`: barra blanca, chips con los colores nuevos y con barrido.
- [ ] **Step 5:** Commit `style: componentes y movimiento en archivos propios; barra superior blanca`.

### Task 3: Salto al cambiar de estado (`useCambio`)

**Files:**
- Create: `src/ui/useCambio.ts`, `src/ui/useCambio.test.tsx`
- Modify: `src/ui/Chip.tsx`, `src/panel/TarjetaFlujo.tsx`, `src/planta/TarjetaTarea.tsx`, `src/ui/chip.test.tsx` (crear si no existe)

**Interfaces:**
- Produces: `export function useCambio<T>(valor: T): number` — devuelve 0 en el primer render y suma 1 cada vez que `valor` cambia (comparación `Object.is`) en un render posterior.
- `Chip` envuelve su contenido en `<span key={n} className={n > 0 ? 'chip … salto' : 'chip …'}>` donde `n = useCambio(estado)`.
- `TarjetaFlujo` / `TarjetaTarea`: un envoltorio interno `<div key={n} className={n > 0 ? 'salto' : undefined}>` alrededor del cuerpo, con `n = useCambio(fila.estado)` / `useCambio(tarea.estado)`. El `motion.article` y su estado (detalle abierto, refs) quedan fuera del envoltorio.

- [ ] **Step 1: Tests que fallan.**
  - `useCambio`: con `renderHook`, `rerender` con el mismo valor → 0; con valor nuevo → 1; con otro → 2.
  - `Chip`: `render(<Chip estado="fabricando" />)` → el `span.chip` **no** tiene `salto`; `rerender(<Chip estado="en_control" />)` → tiene `salto` y dice «En control».
  - `Chip` en primera carga de una lista de 20 chips → ninguno tiene `salto` (Review Focus).
- [ ] **Step 2:** Run `npx vitest run src/ui` → FAIL.
- [ ] **Step 3:** Implementar `useCambio` con `useRef` para el valor anterior y para el contador; aplicar en `Chip`, `TarjetaFlujo`, `TarjetaTarea`.
- [ ] **Step 4:** Run `npx vitest run` → PASS (incluidos los tests existentes de flujo y planta).
- [ ] **Step 5:** Commit `feat(ui): chip y tarjeta dan un salto al cambiar de estado`.

### Task 4: Barra de etapas

**Files:**
- Create: `src/domain/etapas.ts`, `src/domain/etapas.test.ts`, `src/ui/Etapas.tsx`, `src/ui/etapas.test.tsx`
- Modify: `src/panel/TarjetaFlujo.tsx`, `src/panel/DetalleFlujo.tsx` (cabecera, junto al `Chip` de la línea 82), `src/planta/TarjetaTarea.tsx`

**Interfaces:**
- Produces:
  - `export type SecuenciaEtapas = { nombres: string[]; actual: number }` (en `src/domain/etapas.ts`)
  - `export function etapasDe(entidad: string, estado: string): SecuenciaEtapas | null` (entidades válidas: `fabricacion`, `envasado`, `fraccionado`; otra → `null`)
  - `export function Etapas({ etapas }: { etapas: SecuenciaEtapas }): JSX.Element` — `<span className="etapas" role="img" aria-label="Etapa 2 de 5: Fabricando">` con un `<i>` por nombre (`hecha` si índice < actual, `actual` si igual).
- Secuencias:
  - fabricacion: `['Cola', 'Fabricando', 'Control', 'Para envasar', 'Terminada']` — cola 0, fabricando/pausada 1, en_control 2, para_envasar 3, finalizada 4
  - envasado: `['Cola', 'Envasando', 'Terminado']` — cola 0, activo/pausado 1, finalizado 2
  - fraccionado: `['Cola', 'Fraccionando', 'Terminado']` — igual que envasado
  - cancelada/cancelado o estado desconocido → `null`

- [ ] **Step 1: Tests que fallan.**
  - `etapasDe('fabricacion','en_control')` → `{ nombres: [5 nombres], actual: 2 }`
  - `etapasDe('fabricacion','pausada').actual === 1`; `etapasDe('envasado','pausado').actual === 1` (Review Focus)
  - `etapasDe('envasado','cancelado') === null`; `etapasDe('fabricacion','raro') === null` (Review Focus)
  - `<Etapas>` de `{actual: 2}` con 5 nombres → 2 `i.hecha`, 1 `i.actual`, 2 sin clase; `aria-label` «Etapa 3 de 5: Control»
- [ ] **Step 2:** Run `npx vitest run src/domain/etapas.test.ts src/ui/etapas.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar. En las tres pantallas, renderizar `{e && <Etapas etapas={e} />}` con `e = etapasDe(fila.entidad, fila.estado)` debajo de la meta (en la tarjeta del Flujo, después de `tf-operarias` y antes de la barra de avance, que se mantiene).
- [ ] **Step 4:** Run `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(ui): barra segmentada de etapas en flujo, detalle y tablet`.

### Task 5: Pulso «en vivo»

**Files:**
- Create: `src/ui/PulsoVivo.tsx`, `src/ui/pulsoVivo.test.tsx`
- Modify: `src/panel/PanelApp.tsx` (en `.encabezado-derecha`, antes del botón de pausa), `src/planta/PlantaApp.tsx` (en `.planta-barra-der`, junto al reloj), `src/panel/monitor/Monitor.tsx` (en `.monitor-derecha`)

**Interfaces:**
- Consumes: `useEnLinea(): boolean` de `src/lib/useEnLinea.ts`.
- Produces: `export function PulsoVivo({ forzarVivo = false }: { forzarVivo?: boolean }): JSX.Element` — `<span className="pulso-vivo" role="status">` con texto «En vivo»; sin conexión agrega `apagado` y el texto es «Sin conexión». En la demo siempre «En vivo» (la demo no pasa por la red: `PanelApp` ya ignora `enLinea` cuando `demo`; el panel le pasa `forzarVivo={demo}`; tablet y monitor sin prop).

- [ ] **Step 1: Tests que fallan.** Con `navigator.onLine` en true → texto «En vivo», sin `apagado`. Disparar `window.dispatchEvent(new Event('offline'))` (con `onLine` mockeado a false) → «Sin conexión» y clase `apagado` (Review Focus). Con `forzarVivo` y offline → «En vivo». Test existente de `PanelApp`: la banda `Sin conexión — no se pueden guardar cambios.` sigue apareciendo offline.
- [ ] **Step 2:** Run `npx vitest run src/ui/pulsoVivo.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar y colocar en los tres encabezados.
- [ ] **Step 4:** Run `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(ui): pulso «en vivo» en panel, tablet y monitor`.

### Task 6: Partir `panel.css` sin cambiar la salida

**Files:**
- Create: `src/panel/estilos/index.css` y un archivo por sección, en el orden actual: `01-base.css` (líneas 1–85), `02-flujo.css` (86), `03-modal.css` (439), `04-tanques.css` (620), `05-config.css` (884), `06-historial.css` (1041), `07-kpis.css` (1235), `08-alertas.css` (1285), `09-pdf.css` (1365), `10-vida.css` (1507), `11-demo.css` (1643), `12-monitor.css` (1706), `13-modal-bajo.css` (1900), `14-panel-tanque.css` (1946), `15-fabricacion-lista.css` (2062), `16-formularios.css` (2082), `17-tanques-pared.css` (2105), `18-flujo-terminadas.css` (2373), `19-color.css` (2456), `20-operarias.css` (2595), `21-control.css` (2652), `22-pausa.css` (2753), `23-productividad.css` (3098), `24-hoy-en-planta.css` (3502)
- Delete: `src/panel/panel.css`
- Modify: `src/panel/PanelApp.tsx:17` → `import './estilos/index.css'`

**Interfaces:**
- Produces: `index.css` = solo `@import` de los 24 archivos en ese orden. Tasks 7–9 funden estos archivos.

- [ ] **Step 1:** `npm run build` y copiar el CSS generado (`dist/assets/index-*.css`) al scratchpad como `antes.css`.
- [ ] **Step 2:** Cortar `panel.css` por esas líneas (las secciones ya hechas en Tasks 2 movieron líneas: recalcular los cortes con `grep -n '^/\* -----'` en el momento), crear `index.css`, cambiar el import, borrar `panel.css`.
- [ ] **Step 3:** `npm run build` y comparar sin espacios ni saltos: `diff <(tr -d ' \n' < <scratchpad>/antes.css) <(tr -d ' \n' < dist/assets/index-*.css)` → sin diferencias.
- [ ] **Step 4:** Commit `refactor(css): panel.css partido por sección, misma salida`.

### Task 7: Fundir áreas — modales, formularios, PDF, pausa, operarias, control, panel del tanque

**Files:**
- Create: `src/panel/estilos/modal.css` (de 03 + 13 + 15 + 16), `pdf.css` (09), `pausa.css` (22), `orden.css` (20 + 21), `panel-tanque.css` (14)
- Delete: los numerados fundidos
- Modify: `index.css`, y las reglas de `19-color.css` / `10-vida.css` que apuntan a estos selectores se mueven a su área

**Interfaces:**
- Consumes: tokens de Task 1, clases de Task 2. Donde un área definía su propio botón, caja o chip, se reemplaza por la clase de `componentes.css` (TSX solo si hace falta agregar la clase).

- [ ] **Step 1:** Fundir cada grupo: las reglas que pisaban (de 13, 15, 16, 19, 10) se integran en la regla original y se borra la repetida; cada hex pasa a token (crear primitivo en `tokens.css` si no existe uno equivalente).
- [ ] **Step 2:** `npx vitest run && npm run build` → PASS. `grep -nE '#[0-9a-fA-F]{3,8}\b' src/panel/estilos/{modal,pdf,pausa,orden,panel-tanque}.css` → vacío.
- [ ] **Step 3:** Revisar en `npm run dev` (demo): abrir Nueva orden, Subir PDF, Pausa General, detalle de una orden con operarias y control, y el detalle de un tanque a 1366×768 (los botones del modal siguen pegados abajo).
- [ ] **Step 4:** Commit `style(panel): modales, formularios, PDF, pausa y orden con la base B`.

### Task 8: Fundir áreas — KPIs, productividad, historial, alertas, config, demo

**Files:**
- Create: `src/panel/estilos/kpis.css` (07 + 23), `historial.css` (06), `alertas.css` (08), `config.css` (05), `demo.css` (11)
- Modify: `src/panel/kpis/Kpis.tsx` (la `dl.kpis.kpis-grandes` pasa a `.franja-kpi`), `src/panel/kpis/Productividad.tsx` (bloques de datos `.prod-dato*` con `.franja-kpi` si es la misma forma), tablas de Kpis/Historial con `.tabla`; `index.css`

**Interfaces:**
- Consumes: `.franja-kpi*`, `.tabla`, `.caja` de Task 2; `--cifra-*` de Task 1.

- [ ] **Step 1:** Fundir y pasar a tokens como en Task 7. Cifras grandes con `font-family: var(--mono); font-size: var(--cifra-xl); font-weight: var(--cifra-peso); letter-spacing: var(--cifra-tracking)`.
- [ ] **Step 2:** `npx vitest run src/panel/kpis` → PASS (ajustar selectores de test si buscaban `.kpis-grandes`; los textos y valores no cambian). `npm run build` → PASS. Sin hex en los archivos nuevos.
- [ ] **Step 3:** Revisar demo `/kpis` con 3 rangos de fechas (mes en curso, mes anterior, 6 meses).
- [ ] **Step 4:** Commit `style(panel): KPIs, historial, alertas, config y demo con la base B`.

### Task 9: Base en Flujo, Tanques, Monitor, Hoy en planta y tablet

**Files:**
- Create: `src/panel/estilos/flujo.css` (02 + 18 + 24), `tanques.css` (04 + 17), `monitor.css` (12)
- Delete: `10-vida.css`, `19-color.css`, `01-base.css` (lo que quede se reparte o pasa a `app.css`/`componentes.css`)
- Modify: `src/planta/planta.css`, `src/ui/FormularioControl.css`, `src/ui/Tanque.css`, `src/ui/app.css` (`.pared*` de `ParedTanques`), `index.css`; `.tarjeta-flujo` y tarjetas de la tablet suman `.levanta` (en CSS, sin tocar TSX: la regla `.tarjeta-flujo:hover` usa el mismo efecto)

**Interfaces:**
- Consumes: todo lo anterior. Solo base: colores, tipografía, cifras, chips, barra, `levanta`; sin rediseñar la disposición (se reemplaza en los subproyectos 2 y 3).

- [ ] **Step 1:** Fundir y pasar a tokens. El respiro de tarjetas en uso y el destello/ola/burbujas de tanques quedan como están (ya en `movimiento.css`).
- [ ] **Step 2:** `npx vitest run && npm run e2e` → PASS. `grep -rnE '#[0-9a-fA-F]{3,8}\b' src --include=*.css | grep -v tokens.css` → vacío.
- [ ] **Step 3:** Commit `style: flujo, tanques, monitor y tablet con la base B`.

### Task 10: Guardia de colores, verificación y entrega

**Files:**
- Create: `src/ui/sinHex.test.ts`

- [ ] **Step 1:** `sinHex.test.ts`: recorre `src/**/*.css` (con `fs` recursivo) excepto `src/ui/tokens.css` y falla listando archivo:línea de cada `#[0-9a-fA-F]{3,8}\b`. Run → PASS.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npx vitest run && npm run e2e` → todo PASS.
- [ ] **Step 3:** `CAPTURAS=despues npx playwright test capturas` y comparar con `capturas/antes/` vista por vista. Capturar a mano (logueado) Historial, Alertas y Config. Revisar con `prefers-reduced-motion` emulado en DevTools que todo queda quieto.
- [ ] **Step 4:** Commit `test(css): ningún color fuera de los tokens`.
- [ ] **Step 5:** Mostrar las capturas al usuario y esperar su OK. Con el OK: merge a `main` (squash, como 9c44c45) y deploy con el workflow «Publicar en GitHub Pages» (`gh workflow run`), verificar que termine en success.
