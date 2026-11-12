import { describe, expect, it } from 'vitest'
import type { Participacion } from './participaciones'
import { filaH } from '../test/fabricas'
import { diasDelMes, filasPorParticipacion, filtrarHistorial, operariasTexto, moverRango, ordenarHistorial, porDia, rangoDe } from './historial'

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
  it('encuentra una orden por una operaria que solo se sumó', () => {
    const f = [filaH(), filaH({ participaciones: [part('Ana', 'e2', null)] })]
    expect(filtrarHistorial(f, { texto: 'ana' })).toEqual([f[1]])
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

describe('rangoDe', () => {
  it('atajos de fechas a partir de hoy', () => {
    expect(rangoDe('hoy', '2026-10-15')).toEqual({ desde: '2026-10-15', hasta: '2026-10-15' })
    expect(rangoDe('semana', '2026-10-15')).toEqual({ desde: '2026-10-12', hasta: '2026-10-18' })
    expect(rangoDe('mes', '2026-10-15')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
    expect(rangoDe('mesAnterior', '2026-01-15')).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' })
  })
  it('mover un mes o una semana', () => {
    expect(moverRango({ desde: '2026-10-01', hasta: '2026-10-31' }, 'mes', 1)).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' })
    expect(moverRango({ desde: '2026-10-12', hasta: '2026-10-18' }, 'semana', -1)).toEqual({ desde: '2026-10-05', hasta: '2026-10-11' })
  })
})

const part = (nombre: string, empleado_id: string, cantidad: number | null, over: Partial<Participacion> = {}): Participacion => ({
  empleado_id,
  nombre,
  desde: '2026-10-21T10:00:00Z',
  hasta: '2026-10-21T11:00:00Z',
  cantidad,
  unidad: cantidad === null ? null : 'L',
  cantidad_corregida: null,
  minutos: 30,
  ...over,
})

describe('operariasTexto', () => {
  it('nombres con cantidad efectiva, por orden de llegada', () => {
    const f = filaH({
      participaciones: [
        part('Ana', 'e2', 80, { desde: '2026-10-21T10:30:00Z' }),
        part('Marta', 'e1', 120, { cantidad_corregida: 115 }),
      ],
    })
    expect(operariasTexto(f)).toBe('Marta 115 L · Ana 80 L')
  })
  it('sin cantidad solo el nombre; sin participaciones, los nombres de siempre', () => {
    expect(operariasTexto(filaH({ participaciones: [part('Ana', 'e2', null)] }))).toBe('Ana')
    expect(operariasTexto(filaH({ operaria_2_nombre: 'Rosa' }))).toBe('Laura Paz · Rosa')
  })
})

describe('filasPorParticipacion', () => {
  it('una fila por participación y una sola si no hay', () => {
    const a = filaH({ participaciones: [part('Ana', 'e2', 1), part('Marta', 'e1', 2)] })
    const b = filaH()
    expect(filasPorParticipacion([a, b]).map((x) => x.p?.nombre ?? null)).toEqual(['Ana', 'Marta', null])
  })
})
