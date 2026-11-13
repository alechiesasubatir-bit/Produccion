// Lee las hojas de «Movimientos de Produccion — Fabrica Envasado»: una secuencia de bloques
// (granel opcional + consumibles + producto terminado). Reutiliza la grilla de formulaPdf.
import {
  RE_GRANEL,
  RE_LOTE_HEADER,
  RE_SUFIJO_GRANEL,
  bloquesDePagina,
  leerCabecera,
  leerRenglones,
  type Fragmento,
  type Par,
} from './formulaPdf'

export type Consumible = { codigo: string; descripcion: string; cantidad: number }
export type BloqueDocumento = {
  tipo: 'envasado' | 'fraccionado'
  granel: { codigo: string; nombre: string; litros: number } | null // null en fraccionado
  producto: { codigo: string; descripcion: string; cantidad: number }
  presentacion: string | null // nombre normalizado tipo '1.5L', '500g' o null
  consumibles: Consumible[]
}
export type DocumentoEnvasado = { lote: string; fecha: string; bloques: BloqueDocumento[] }

const ERROR_FORMATO = 'Este PDF no tiene el formato de una hoja de envasado. Cargá la orden a mano.'

const RE_LITROS = /\bx\s*(\d+(?:[.,]\d+)?)\s*(?:l|lts?|litros?)(?![a-z])/i
const RE_KILOS = /\bx\s*(1\/2|1\/4|\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilos?)(?![a-z])/i
const RE_GRAMOS = /\bx\s*(\d+)\s*(?:g|gr|grs|gramos?)(?![a-z])/i

/** Presentación normalizada deducida del nombre del producto terminado, o null si no hay patrón. */
export function presentacionDe(descripcion: string): string | null {
  const litros = RE_LITROS.exec(descripcion)
  if (litros) return `${litros[1].replace(',', '.')}L`
  const kilos = RE_KILOS.exec(descripcion)
  if (kilos) {
    if (kilos[1] === '1/2') return '500g'
    if (kilos[1] === '1/4') return '250g'
    return `${kilos[1].replace(',', '.')}kg`
  }
  const gramos = RE_GRAMOS.exec(descripcion)
  if (gramos) return `${gramos[1]}g`
  return null
}

type Comprobante = { cabecera: { lote: string; fecha: string }; pares: Par[] }

function comprobantes(fr: Fragmento[]): Comprobante[] {
  const paginas = [...new Set(fr.map((f) => f.pagina))].sort((a, b) => a - b)
  const res: Comprobante[] = []
  for (const pagina of paginas) {
    for (const bloque of bloquesDePagina(fr.filter((f) => f.pagina === pagina))) {
      const cabecera = leerCabecera(bloque)
      const pares = leerRenglones(bloque)
      if (cabecera && pares) res.push({ cabecera, pares })
    }
  }
  return res
}

const esFormula = (c: Comprobante) => c.pares.some((p) => RE_GRANEL.test(p.codigo) && !p.conParentesis)
const esEnvasado = (c: Comprobante) => !esFormula(c) && c.pares.some((p) => !p.conParentesis)

/** Tipo de hoja: cualquier comprobante con renglón F sin paréntesis es fórmula (aunque tenga
 * también cierres de envasado); si no, envasado si hay un producto terminado sin paréntesis. */
export function tipoDeHoja(fr: Fragmento[]): 'formula' | 'envasado' | null {
  const cs = comprobantes(fr)
  if (cs.some(esFormula)) return 'formula'
  if (cs.some(esEnvasado)) return 'envasado'
  return null
}

function bloquesDe(pares: Par[]): BloqueDocumento[] {
  const bloques: BloqueDocumento[] = []
  let granel: BloqueDocumento['granel'] = null
  let consumibles: Consumible[] = []
  for (const p of pares) {
    if (!p.conParentesis) {
      bloques.push({
        tipo: granel ? 'envasado' : 'fraccionado',
        granel,
        producto: { codigo: p.codigo, descripcion: p.descripcion, cantidad: p.cantidad },
        presentacion: presentacionDe(p.descripcion),
        consumibles,
      })
      granel = null
      consumibles = []
    } else if (RE_GRANEL.test(p.codigo)) {
      granel ??= { codigo: p.codigo, nombre: p.descripcion.replace(RE_SUFIJO_GRANEL, ''), litros: p.cantidad }
    } else if (p.cantidad > 0) {
      // Un consumible en cero no se usó: no entra (la base rechaza cantidades <= 0 y fallaría toda la tarjeta).
      consumibles.push({ codigo: p.codigo, descripcion: p.descripcion, cantidad: p.cantidad })
    }
  }
  // Lo que queda sin renglón de cierre al final de la tabla se descarta.
  return bloques
}

export function leerEnvasados(
  fr: Fragmento[],
): { ok: true; documentos: DocumentoEnvasado[] } | { ok: false; error: string } {
  if (fr.length === 0 || !fr.some((f) => RE_LOTE_HEADER.test(f.str.trim()))) return { ok: false, error: ERROR_FORMATO }
  if (tipoDeHoja(fr) !== 'envasado') return { ok: false, error: ERROR_FORMATO }
  const documentos: DocumentoEnvasado[] = []
  for (const c of comprobantes(fr).filter(esEnvasado)) {
    const bloques = bloquesDe(c.pares)
    if (bloques.length) documentos.push({ lote: c.cabecera.lote, fecha: c.cabecera.fecha, bloques })
  }
  if (documentos.length === 0) return { ok: false, error: ERROR_FORMATO }
  return { ok: true, documentos }
}
