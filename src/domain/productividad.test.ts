import { describe, expect, it } from 'vitest'
import { filaH } from '../test/fabricas'
import type { Participacion } from './participaciones'
import { mesesHasta, nombreMes, productividadMensual, rangoDeMeses } from './productividad'

const tramo = (empleado_id: string, nombre: string, desde: string, cantidad: number | null, minutos: number, over: Partial<Participacion> = {}): Participacion => ({
  empleado_id,
  nombre,
  desde,
  hasta: desde,
  cantidad,
  unidad: 'L',
  cantidad_corregida: null,
  minutos,
  ...over,
})

const MESES = ['2026-09', '2026-10', '2026-11']

describe('mesesHasta / nombreMes', () => {
  it('cuenta hacia atrás cruzando el año', () => {
    expect(mesesHasta('2026-02-28', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(nombreMes('2026-11')).toBe('nov 26')
    expect(rangoDeMeses(['2025-12', '2026-01', '2026-02'])).toEqual({ desde: '2025-12-01', hasta: '2026-02-28' })
  })
})

describe('productividadMensual', () => {
  it('tasa por hora de cada operaria y del equipo en cada mes, con la variación mes a mes y contra el equipo', () => {
    const filas = [
      filaH({ participaciones: [tramo('A', 'Ana', '2026-10-05T12:00:00Z', 600, 60), tramo('B', 'Bea', '2026-10-05T12:00:00Z', 300, 60)] }),
      filaH({ participaciones: [tramo('A', 'Ana', '2026-11-05T12:00:00Z', 900, 60), tramo('B', 'Bea', '2026-11-06T12:00:00Z', 300, 60)] }),
    ]
    const [g] = productividadMensual(filas, MESES)
    expect(g).toMatchObject({ titulo: 'Fabricación · Lavandina', unidad: 'L/h' })
    expect(g.equipo.map((c) => c?.porHora ?? null)).toEqual([null, 450, 600])
    const [ana, bea] = g.filas
    expect(ana.nombre).toBe('Ana')
    expect(ana.meses.map((c) => c?.porHora ?? null)).toEqual([null, 600, 900])
    expect(ana.variaciones).toEqual([null, null, 50])
    expect(ana.vsEquipoPct).toBe(50)
    expect(bea.variaciones).toEqual([null, null, 0])
    expect(bea.vsEquipoPct).toBe(-50)
  })

  it('separa por producto y por presentación; el envasado va en unidades por hora', () => {
    const env = (presentacion: string, litros_equiv: number, cantidad: number) =>
      filaH({ entidad: 'envasado', estado: 'finalizado', presentacion, litros_equiv, participaciones: [tramo('A', 'Ana', '2026-11-02T12:00:00Z', cantidad, 30)] })
    const grupos = productividadMensual([env('5L', 5, 500), env('1L', 1, 200), filaH({ producto: 'Suavizante', participaciones: [tramo('A', 'Ana', '2026-11-02T12:00:00Z', 100, 60)] })], MESES)
    expect(grupos.map((g) => [g.titulo, g.unidad, g.equipo[2]?.porHora])).toEqual(
      expect.arrayContaining([
        ['Envasado · Lavandina 5L', 'u/h', 200],
        ['Envasado · Lavandina 1L', 'u/h', 400],
        ['Fabricación · Suavizante', 'L/h', 100],
      ]),
    )
  })

  it('usa la cantidad corregida y deja afuera tramos abiertos, sin cantidad, en cero, muy cortos, cancelados, de stock o fuera de los meses', () => {
    const filas = [
      filaH({
        participaciones: [
          tramo('A', 'Ana', '2026-11-01T12:00:00Z', 100, 60, { cantidad_corregida: 120 }),
          tramo('A', 'Ana', '2026-11-01T12:00:00Z', 999, 60, { hasta: null }),
          tramo('A', 'Ana', '2026-11-01T12:00:00Z', null, 60),
          tramo('A', 'Ana', '2026-11-01T12:00:00Z', 0, 60, { motivo: 'Pausa General' }),
          tramo('A', 'Ana', '2026-11-01T12:00:00Z', 999, 2),
          tramo('A', 'Ana', '2026-06-01T12:00:00Z', 999, 60),
        ],
      }),
      filaH({ estado: 'cancelada', participaciones: [tramo('A', 'Ana', '2026-11-01T12:00:00Z', 999, 60)] }),
      filaH({ origen: 'stock', participaciones: [tramo('A', 'Ana', '2026-11-01T12:00:00Z', 999, 60)] }),
    ]
    const [g] = productividadMensual(filas, MESES)
    expect(g.filas[0].meses[2]).toEqual({ cantidad: 120, minutos: 60, tramos: 1, porHora: 120 })
  })

  it('el mes es el de Montevideo: un tramo del 1.º a la 1 h UTC es del mes anterior', () => {
    const [g] = productividadMensual([filaH({ participaciones: [tramo('A', 'Ana', '2026-11-01T01:00:00Z', 60, 60)] })], MESES)
    expect(g.filas[0].meses.map((c) => c?.porHora ?? null)).toEqual([null, 60, null])
  })

  it('sin tramos con cantidad no hay grupos (órdenes viejas sin participaciones)', () => {
    expect(productividadMensual([filaH()], MESES)).toEqual([])
  })
})
