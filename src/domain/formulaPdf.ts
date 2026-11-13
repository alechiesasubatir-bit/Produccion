// Lee las fórmulas (granel + materias primas) del PDF «Movimientos de Produccion» a partir de
// los fragmentos de texto que extrae pdf.js. El PDF no tiene columnas alineadas en una grilla:
// se reconstruye la tabla comparando posiciones (x,y) de cada fragmento.
import { aNumero } from './escaneo'

export type Fragmento = { str: string; x: number; y: number; pagina: number }
export type MpFormula = { codigo: string; descripcion: string; cantidad: number }
export type Formula = {
  lote: string
  fecha: string // YYYY-MM-DD
  granel: { codigo: string; nombre: string; litros: number }
  mp: MpFormula[]
}

const ERROR_FORMATO = 'Este PDF no tiene el formato de Movimientos de Produccion. Cargá la orden a mano.'

export const RE_LOTE_HEADER = /^LOTE/i
const RE_FECHA_HEADER = /^FECHA$/i
const RE_VENCIMIENTO = /^VENCIMIENTO/i
const RE_FECHA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
export const RE_CODIGO = /^(F\d+|\d+)$/i
export const RE_GRANEL = /^F\d+$/i
const RE_CANTIDAD = /^\(?[\d,]+\.\d+\)?$/
const RE_CODIGO_HEADER = /^C.digo/i
const RE_CANTIDAD_HEADER = /^Cantidad/i
const RE_DESCRIPCION_HEADER = /^Descripci/i
const RE_LOTE_TABLA_HEADER = /^Lote$/i
const RE_FIN_TANQUE = /^Tanque destinado/i
const RE_FIN_OBSERVACIONES = /^Observaciones/i
export const RE_SUFIJO_GRANEL = /\s*\(granel\)\s*$/i

const TOLERANCIA_LOTE_Y = 30
const TOLERANCIA_LOTE_X = 40
const TOLERANCIA_FILA_Y = 2
const MARGEN_CANTIDAD_CODIGO = 5
const MARGEN_CANTIDAD_RENGLON = 15
const MARGEN_LOTE_TABLA = 5

function fechaIso(s: string): string {
  const m = RE_FECHA.exec(s)
  if (!m) return ''
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/** Agrupa fragmentos ya ordenados por y desc en filas, con tolerancia ±2 pt. */
export function agruparPorFila(fragmentos: Fragmento[]): Fragmento[][] {
  const grupos: Fragmento[][] = []
  for (const f of fragmentos) {
    const grupo = grupos.find((g) => Math.abs(g[0].y - f.y) <= TOLERANCIA_FILA_Y)
    if (grupo) grupo.push(f)
    else grupos.push([f])
  }
  return grupos
}

/** Fecha de la fórmula: la que está debajo del «FECHA» del comprobante (en la fila de «LOTE Nº»),
 * no la de «FECHA VENCIMIENTO». Sin ese rótulo, la primera con forma de fecha. */
export function leerFecha(bloque: Fragmento[], loteHeader: Fragmento): string {
  const vencimientos = bloque.filter((f) => RE_VENCIMIENTO.test(f.str.trim()))
  const deVencimiento = (r: Fragmento) =>
    vencimientos.some((v) => Math.abs(v.x - r.x) < TOLERANCIA_LOTE_X && Math.abs(v.y - r.y) <= TOLERANCIA_LOTE_Y)
  const rotulos = bloque.filter((f) => RE_FECHA_HEADER.test(f.str.trim()))
  const rotulo = rotulos
    .filter((r) => !deVencimiento(r))
    .sort((a, b) => Math.abs(a.y - loteHeader.y) - Math.abs(b.y - loteHeader.y))[0]
  if (!rotulos.length) {
    const primera = bloque.find((f) => RE_FECHA.test(f.str.trim()))
    return primera ? fechaIso(primera.str.trim()) : ''
  }
  if (!rotulo) return ''
  const debajo = bloque
    .filter(
      (f) =>
        RE_FECHA.test(f.str.trim()) &&
        f.y < rotulo.y &&
        rotulo.y - f.y <= TOLERANCIA_LOTE_Y &&
        Math.abs(f.x - rotulo.x) < TOLERANCIA_LOTE_X,
    )
    .sort((a, b) => b.y - a.y)[0]
  return debajo ? fechaIso(debajo.str.trim()) : ''
}

export type Par = { codigo: string; cantidad: number; descripcion: string; conParentesis: boolean }

/** Lote y fecha (YYYY-MM-DD) del comprobante de un bloque de fragmentos. */
export function leerCabecera(bloque: Fragmento[]): { lote: string; fecha: string } | null {
  const loteHeader = bloque.find((f) => RE_LOTE_HEADER.test(f.str.trim()))
  if (!loteHeader) return null

  const loteNum = bloque.find(
    (f) =>
      /^\d+$/.test(f.str.trim()) &&
      f.y < loteHeader.y &&
      loteHeader.y - f.y <= TOLERANCIA_LOTE_Y &&
      Math.abs(f.x - loteHeader.x) < TOLERANCIA_LOTE_X,
  )
  const lote = loteNum?.str.trim() ?? ''

  return { lote, fecha: leerFecha(bloque, loteHeader) }
}

/** Renglones (código, cantidad, descripción) de la tabla de un comprobante, de arriba hacia abajo. */
export function leerRenglones(bloque: Fragmento[]): Par[] | null {
  const headerCantidad = bloque.find((f) => RE_CANTIDAD_HEADER.test(f.str.trim()))
  const headerDescripcion = bloque.find((f) => RE_DESCRIPCION_HEADER.test(f.str.trim()))
  const headerCodigo = bloque.find((f) => RE_CODIGO_HEADER.test(f.str.trim()))
  if (!headerCantidad || !headerDescripcion || !headerCodigo) return null
  const headerLoteTabla = bloque.find((f) => RE_LOTE_TABLA_HEADER.test(f.str.trim()) && f.x > headerDescripcion.x)
  if (!headerLoteTabla) return null

  const finFrag = bloque.find((f) => RE_FIN_TANQUE.test(f.str.trim())) ?? bloque.find((f) => RE_FIN_OBSERVACIONES.test(f.str.trim()))
  const yFin = finFrag ? finFrag.y : -Infinity

  const filas = bloque.filter((f) => f.y < headerCodigo.y && f.y > yFin)

  const codigos = filas
    .filter((f) => f.x < headerCantidad.x - MARGEN_CANTIDAD_CODIGO && RE_CODIGO.test(f.str.trim()))
    .sort((a, b) => b.y - a.y)

  const candidatosRenglon = filas.filter(
    (f) => f.x >= headerCantidad.x - MARGEN_CANTIDAD_RENGLON && f.x < headerLoteTabla.x - MARGEN_LOTE_TABLA,
  )
  const renglones = agruparPorFila(candidatosRenglon.sort((a, b) => b.y - a.y)).sort((a, b) => b[0].y - a[0].y)

  // Cada código va con el renglón a su misma altura: una descripción partida en dos renglones
  // agrega uno sin código, y emparejar por orden correría todas las cantidades siguientes.
  // Solo si ningún código encuentra renglón a su altura se empareja por orden (último recurso).
  const porAltura = codigos.map((c) => renglones.find((r) => Math.abs(r[0].y - c.y) <= TOLERANCIA_FILA_Y) ?? null)
  const emparejados: [Fragmento, Fragmento[]][] = porAltura.some(Boolean)
    ? codigos.flatMap((c, i) => (porAltura[i] ? [[c, porAltura[i]] as [Fragmento, Fragmento[]]] : []))
    : codigos.slice(0, renglones.length).map((c, i) => [c, renglones[i]] as [Fragmento, Fragmento[]])
  const usados = new Set(emparejados.map(([, r]) => r))

  const pares: Par[] = []
  for (const [codigo, renglon] of emparejados) {
    const fila = [...renglon].sort((a, b) => a.x - b.x)
    const idxCantidad = fila.findIndex((f) => RE_CANTIDAD.test(f.str.trim()))
    if (idxCantidad === -1) continue
    const strCantidad = fila[idxCantidad].str.trim()
    const cantidad = aNumero(strCantidad.replace(/[()]/g, ''))
    if (cantidad === null) continue
    // Renglones sueltos (sin código) debajo de este y antes del siguiente: continuación de la descripción.
    const siguiente = Math.max(...emparejados.map(([c]) => c.y).filter((y) => y < codigo.y - TOLERANCIA_FILA_Y), yFin)
    const continuacion = renglones
      .filter((r) => !usados.has(r) && r[0].y < codigo.y - TOLERANCIA_FILA_Y && r[0].y > siguiente + TOLERANCIA_FILA_Y)
      .flatMap((r) => [...r].sort((a, b) => a.x - b.x))
    const descripcion = [...fila.filter((_, idx) => idx !== idxCantidad), ...continuacion]
      .map((f) => f.str.trim())
      .join(' ')
      .trim()
    pares.push({
      codigo: codigo.str.trim(),
      cantidad,
      descripcion,
      conParentesis: strCantidad.startsWith('('),
    })
  }

  return pares
}

/** Extrae la fórmula de un bloque de fragmentos (todos los de un mismo LOTE). */
function leerBloque(bloque: Fragmento[]): Formula | null {
  const cabecera = leerCabecera(bloque)
  const pares = leerRenglones(bloque)
  if (!cabecera || !pares) return null
  const { lote, fecha } = cabecera

  const granelPar = pares.find((p) => RE_GRANEL.test(p.codigo))
  if (!granelPar) return null

  return {
    lote,
    fecha,
    granel: {
      codigo: granelPar.codigo,
      nombre: granelPar.descripcion.replace(RE_SUFIJO_GRANEL, ''),
      litros: granelPar.cantidad,
    },
    mp: pares
      .filter((p) => p.conParentesis)
      .map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, cantidad: p.cantidad })),
  }
}

/** Divide los fragmentos de una página en bloques, uno por cada «LOTE» (de su y hacia abajo).
 * «Lote» también es el encabezado de una columna de la tabla (a la misma altura que «Código»):
 * se excluye para no confundirlo con el «LOTE Nº» del comprobante. */
export function bloquesDePagina(fragmentos: Fragmento[]): Fragmento[][] {
  const yEncabezadosTabla = fragmentos.filter((f) => RE_CODIGO_HEADER.test(f.str.trim())).map((f) => f.y)
  const lotes = fragmentos
    .filter((f) => RE_LOTE_HEADER.test(f.str.trim()) && !yEncabezadosTabla.some((y) => Math.abs(y - f.y) <= TOLERANCIA_FILA_Y))
    .sort((a, b) => b.y - a.y)
  return lotes.map((loteFrag, i) => {
    const limiteInferior = i + 1 < lotes.length ? lotes[i + 1].y : -Infinity
    return fragmentos.filter((f) => f.y <= loteFrag.y && f.y > limiteInferior)
  })
}

export function leerFormulas(fr: Fragmento[]): { ok: true; formulas: Formula[] } | { ok: false; error: string } {
  if (fr.length === 0 || !fr.some((f) => RE_LOTE_HEADER.test(f.str.trim()))) {
    return { ok: false, error: ERROR_FORMATO }
  }

  const paginas = [...new Set(fr.map((f) => f.pagina))].sort((a, b) => a - b)
  const formulas: Formula[] = []
  for (const pagina of paginas) {
    const fragmentosPagina = fr.filter((f) => f.pagina === pagina)
    for (const bloque of bloquesDePagina(fragmentosPagina)) {
      const formula = leerBloque(bloque)
      if (formula) formulas.push(formula)
    }
  }

  if (formulas.length === 0) return { ok: false, error: ERROR_FORMATO }
  return { ok: true, formulas }
}
