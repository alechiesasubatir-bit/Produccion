import { describe, expect, it } from 'vitest'
import { filaH } from '../test/fabricas'
import { porProducto, rankingOperarias, resumenOperaciones, tiemposVsEstandar } from './kpis'

const env = (over = {}) =>
  filaH({ entidad: 'envasado', estado: 'finalizado', presentacion: '5L', litros_equiv: 5, cantidad: 100, litros: 500, ...over })

describe('rankingOperarias', () => {
  it('cuenta a las dos operarias de un envasado y ordena por unidades', () => {
    const r = rankingOperarias([
      env({ operaria_1: 'E1', operaria_1_nombre: 'Laura', operaria_2: 'E2', operaria_2_nombre: 'Rosa', cantidad: 100, min_efectivos: 50 }),
      env({ operaria_1: 'E2', operaria_1_nombre: 'Rosa', cantidad: 60, min_efectivos: 30 }),
    ])
    expect(r.map((x) => [x.nombre, x.tareas, x.unidades])).toEqual([
      ['Rosa', 2, 160],
      ['Laura', 1, 100],
    ])
    expect(r[0].unidadesPorMin).toBe(2)
  })
  it('ignora lo no terminado', () => {
    expect(rankingOperarias([env({ estado: 'activo' })])).toEqual([])
  })
})

describe('porProducto', () => {
  it('agrupa por producto y presentación', () => {
    const r = porProducto([env({ cantidad: 100, min_efectivos: 50 }), env({ cantidad: 50, litros: 250, min_efectivos: 50 })])
    expect(r).toEqual([{ producto: 'Lavandina', presentacion: '5L', tareas: 2, unidades: 150, litros: 750, unidadesPorMin: 1.5 }])
  })
})

describe('resumenOperaciones', () => {
  it('suma solo lo terminado', () => {
    const r = resumenOperaciones([
      filaH({ litros: 1000, min_efectivos: 60, min_pausa: 10 }),
      env({ cantidad: 100, min_efectivos: 50, min_pausa: 5 }),
      filaH({ estado: 'fabricando', litros: 999 }),
    ])
    expect(r).toEqual({
      fabricaciones: 1,
      envasados: 1,
      fraccionados: 0,
      litrosFabricados: 1000,
      unidadesEnvasadas: 100,
      minutosEfectivos: 110,
      minutosPausa: 15,
    })
  })
})

describe('tiemposVsEstandar', () => {
  it('compara contra litros/hora estándar del producto y marca el desvío', () => {
    // real: 1000 L en 100 min = 10 L/min; estándar 900 L/h = 15 L/min → 33 % más lento
    const r = tiemposVsEstandar(
      [filaH({ litros: 1000, min_efectivos: 100 })],
      [{ entidad: 'fabricacion', clave: 'Lavandina', velocidad: 12, muestras: 4, litros_hora_std: 900 }],
    )
    expect(r).toEqual([{ producto: 'Lavandina', real: 10, estandar: 15, desvioPct: 33 }])
  })
  it('sin estándar configurado usa la velocidad histórica', () => {
    const r = tiemposVsEstandar(
      [filaH({ litros: 1200, min_efectivos: 100 })],
      [{ entidad: 'fabricacion', clave: 'Lavandina', velocidad: 12, muestras: 4, litros_hora_std: null }],
    )
    expect(r[0]).toMatchObject({ real: 12, estandar: 12, desvioPct: 0 })
  })
})
