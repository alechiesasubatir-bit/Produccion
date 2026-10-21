import { describe, expect, it, vi } from 'vitest'
import { cargarHistorial } from './datosHistorial'

const rangos: Array<[number, number]> = []

vi.mock('../../lib/supabase', async () => {
  const { fetchAll } = await import('../../lib/fetchAll')
  const consulta = {
    select: () => consulta,
    gte: () => consulta,
    lte: () => consulta,
    order: () => consulta,
    range: (desde: number, hasta: number) => {
      rangos.push([desde, hasta])
      const n = rangos.length === 1 ? 1000 : 3
      return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: `${desde + i}` })), error: null })
    },
  }
  return { db: { from: () => consulta }, fetchAll }
})

describe('cargarHistorial', () => {
  it('pagina de a 1000 filas (rangos de más de 1000 tareas)', async () => {
    const filas = await cargarHistorial({ desde: '2026-01-01', hasta: '2026-12-31' })
    expect(filas).toHaveLength(1003)
    expect(rangos).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })
})
