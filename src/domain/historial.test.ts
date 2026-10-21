import { describe, expect, it } from 'vitest'
import { filaH } from '../test/fabricas'
import { diasDelMes, filtrarHistorial, ordenarHistorial, porDia } from './historial'

describe('porDia', () => {
  it('cada tarea cae en un solo día (el de la vista)', () => {
    const cruza = filaH({ dia: '2026-01-06', inicio: '2026-01-06T02:30:00Z', fin: '2026-01-06T04:15:00Z' })
    const otra = filaH({ dia: '2026-01-05' })
    const g = porDia([cruza, otra])
    expect(g.get('2026-01-06')).toEqual([cruza])
    expect(g.get('2026-01-05')).toEqual([otra])
    expect([...g.values()].flat()).toHaveLength(2)
  })
})

describe('filtrarHistorial', () => {
  it('busca sin tildes ni mayúsculas en producto, lote, tanque y nombres', () => {
    const f = [filaH({ producto: 'Lavandina' }), filaH({ producto: 'Cloro', operaria_1_nombre: 'Rosa Díaz' })]
    expect(filtrarHistorial(f, { texto: 'lavandína' })).toEqual([f[0]])
    expect(filtrarHistorial(f, { texto: 'diaz' })).toEqual([f[1]])
  })
  it('filtra por tipo y estado', () => {
    const f = [filaH(), filaH({ entidad: 'envasado', estado: 'cancelado' })]
    expect(filtrarHistorial(f, { entidad: 'envasado' })).toEqual([f[1]])
    expect(filtrarHistorial(f, { estado: 'finalizada' })).toEqual([f[0]])
  })
})

describe('ordenarHistorial', () => {
  it('ordena números y nulos al final', () => {
    const a = filaH({ min_efectivos: 30 })
    const b = filaH({ min_efectivos: null })
    const c = filaH({ min_efectivos: 90 })
    expect(ordenarHistorial([a, b, c], 'min_efectivos', false).map((f) => f.min_efectivos)).toEqual([90, 30, null])
    expect(ordenarHistorial([a, b, c], 'min_efectivos', true).map((f) => f.min_efectivos)).toEqual([30, 90, null])
  })
})

describe('diasDelMes', () => {
  it('grilla de lunes a domingo con relleno', () => {
    const d = diasDelMes(2026, 10)
    expect(d[0]).toBe('2026-09-28')
    expect(d.length % 7).toBe(0)
    expect(d).toContain('2026-10-31')
    expect(d.at(-1)).toBe('2026-11-01')
  })
})
