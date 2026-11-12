export type EventoRecorrido = {
  at: string
  accion: string
  /** Quien hizo el evento (operaria que lo disparó, o «Encargada»). */
  quien: string
  entidad: string
  /** Operaria a la que se refiere el evento, si es otra persona que `quien`. */
  sujeto?: string | null
  /** Usuario del panel que lo hizo (encargada), si se pudo resolver. */
  usuario?: string | null
  datos?: unknown
}

const nf = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 2 })
const fechaAr = (iso: string) => iso.split('-').reverse().join('/')

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const cant = (n: unknown, unidad: unknown) => (typeof n === 'number' ? `${nf.format(n)}${typeof unidad === 'string' ? ` ${unidad}` : ''}` : null)

/** Texto de los eventos de operarias; null si es un evento común (se arma con verbo y autor). */
export function textoEventoOperaria(e: EventoRecorrido): string | null {
  const d = obj(e.datos)
  if (e.accion === 'sumarse') return `${e.quien} se sumó`
  if (e.accion === 'salir') {
    const c = cant(d.cantidad, d.unidad)
    return c ? `${e.quien} salió (${c})` : `${e.quien} salió`
  }
  if (e.accion === 'corregir') {
    const antes = typeof d.antes === 'number' ? nf.format(d.antes) : '—'
    const despues = cant(d.despues, d.unidad) ?? '—'
    return `${e.usuario || 'La encargada'} corrigió a ${e.sujeto ?? 'la operaria'}: ${antes} → ${despues}`
  }
  if (e.accion === 'aprobar') return `${e.usuario || 'La encargada'} aprobó el control`
  if (e.accion === 'rechazar') {
    const motivo = typeof d.motivo === 'string' ? d.motivo.trim() : ''
    return `${e.usuario || 'La encargada'} rechazó el control${motivo ? `: ${motivo}` : ''}`
  }
  const venc = obj(d.vencimiento)
  if (e.accion === 'editar' && typeof venc.despues === 'string') {
    const quien = e.quien !== 'Encargada' ? e.quien : e.usuario || 'La encargada'
    return `${quien} cambió el vencimiento a ${fechaAr(venc.despues)}`
  }
  return null
}
