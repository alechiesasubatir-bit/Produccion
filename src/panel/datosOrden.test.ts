import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cargarDatosOrden, cargarLotesDocumento } from './datosOrden'

type Llamada = { tabla: string; cols?: string; filtros: Array<[string, ...unknown[]]> }
const llamadas: Llamada[] = []
let respuestas: Record<string, (l: Llamada) => unknown[]> = {}

vi.mock('../lib/supabase', async () => {
  const { fetchAll } = await import('../lib/fetchAll')
  const consulta = (tabla: string) => {
    const l: Llamada = { tabla, filtros: [] }
    llamadas.push(l)
    const q: Record<string, unknown> = {}
    for (const op of ['not', 'neq', 'eq', 'in', 'order']) q[op] = (...a: unknown[]) => (l.filtros.push([op, ...a]), q)
    q.select = (cols: string) => ((l.cols = cols), q)
    q.range = () => Promise.resolve({ data: respuestas[tabla]?.(l) ?? [], error: null })
    q.maybeSingle = () => Promise.resolve({ data: null, error: null })
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: respuestas[tabla]?.(l) ?? [], error: null }).then(ok, ko)
    return q
  }
  return { db: { from: consulta }, fetchAll }
})
vi.mock('./historial/datosHistorial', () => ({ cargarEstandares: () => Promise.resolve([]) }))

beforeEach(() => {
  llamadas.length = 0
  respuestas = {}
})

describe('cargarDatosOrden', () => {
  it('pide solo las fabricaciones abiertas para los tanques y los lotes por separado, sin leer envasados/fraccionados', async () => {
    respuestas = {
      fabricaciones: (l) =>
        l.cols === 'lote'
          ? [{ lote: ' L1 ' }, { lote: 'L2' }, { lote: null }]
          : [{ id: 'a', lote: 'L1', producto_id: 'p', tanque_id: 't', litros: 100, estado: 'fabricando' }],
    }
    const d = await cargarDatosOrden()
    const abiertas = llamadas.find((l) => l.tabla === 'fabricaciones' && l.cols !== 'lote')!
    expect(abiertas.filtros).toContainEqual(['in', 'estado', ['cola', 'fabricando', 'pausada', 'en_control', 'para_envasar']])
    expect(d.fabricacionesAbiertas).toEqual([{ id: 'a', producto_id: 'p', tanque_id: 't', lote: 'L1', litros: 100, sinAsignar: 100 }])
    expect(d.lotesAbiertos).toEqual(['L1', 'L2'])
    expect(llamadas.some((l) => l.tabla === 'fraccionados')).toBe(false)
    expect(llamadas.filter((l) => l.tabla === 'envasados').every((l) => l.cols?.startsWith('fabricacion_id'))).toBe(true)
  })
})

describe('cargarLotesDocumento', () => {
  it('consulta solo los lotes del PDF en la tabla de la pestaña', async () => {
    respuestas = { envasados: () => [{ lote: '99001' }] }
    const r = await cargarLotesDocumento('envasado', ['99001', '99002'])
    expect([...r]).toEqual(['99001'])
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].tabla).toBe('envasados')
    expect(llamadas[0].filtros).toContainEqual(['in', 'lote', ['99001', '99002']])
  })
  it('fraccionado mira fraccionados, no envasados', async () => {
    respuestas = { fraccionados: () => [{ lote: '99003' }] }
    const r = await cargarLotesDocumento('fraccionado', ['99003'])
    expect(r.has('99003')).toBe(true)
    expect(llamadas.map((l) => l.tabla)).toEqual(['fraccionados'])
  })
  it('sin lotes no consulta', async () => {
    expect((await cargarLotesDocumento('envasado', [])).size).toBe(0)
    expect(llamadas).toHaveLength(0)
  })
})
