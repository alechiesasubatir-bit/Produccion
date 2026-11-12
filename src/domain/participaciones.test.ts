import { describe, expect, it } from 'vitest'
import { cantidadEfectiva, esperadoEnvasado, totalDeclarado } from './participaciones'

const p = (over: object) => ({ hasta: '2026-10-21T14:00:00Z', cantidad: null, cantidad_corregida: null, unidad: 'L' as const, ...over })

describe('participaciones', () => {
  it('cantidadEfectiva prefiere la corregida', () => {
    expect(cantidadEfectiva({ cantidad: 120, cantidad_corregida: 115 })).toBe(115)
    expect(cantidadEfectiva({ cantidad: 120, cantidad_corregida: null })).toBe(120)
    expect(cantidadEfectiva({ cantidad: null, cantidad_corregida: null })).toBeNull()
  })

  it('totalDeclarado suma efectivas y cuenta las cerradas sin cantidad', () => {
    const r = totalDeclarado([p({ cantidad: 120, cantidad_corregida: 115 }), p({ cantidad: 50 }), p({}), p({ hasta: null })])
    expect(r).toMatchObject({ total: 165, unidad: 'L', faltan: 1 })
  })

  it('unidades mezcladas no dan una unidad única', () => {
    const r = totalDeclarado([p({ cantidad: 10 }), p({ cantidad: 5, unidad: 'kg' })])
    expect(r.unidad).toBeNull()
    expect(r.porUnidad).toEqual({ L: 10, kg: 5 })
  })

  it('esperadoEnvasado multiplica por los litros de la presentación', () => {
    expect(esperadoEnvasado(100, 1)).toBe(100)
    expect(esperadoEnvasado(40, 5)).toBe(200)
  })
})
