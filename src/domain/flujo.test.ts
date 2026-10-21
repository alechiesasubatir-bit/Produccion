import { describe, expect, it } from 'vitest'
import { agruparFlujo, COLUMNAS, columnaFlujo, kpisFlujo, type FilaFlujo } from './flujo'

let n = 0
export function fila(over: Partial<FilaFlujo> = {}): FilaFlujo {
  n += 1
  return {
    entidad: 'fabricacion',
    id: `f${n}`,
    estado: 'cola',
    producto: 'Lavandina',
    color: '#0284c7',
    tanque_codigo: 'T-01',
    presentacion: null,
    cantidad: null,
    litros: 1000,
    lote: null,
    descripcion: null,
    operaria_1: null,
    operaria_2: null,
    listo: true,
    inicio: null,
    min_efectivos: null,
    corriendo: false,
    created_at: `2026-10-21T10:${String(n).padStart(2, '0')}:00Z`,
    fin: null,
    fabricacion_id: null,
    litros_restantes: null,
    ...over,
  }
}

describe('columnaFlujo', () => {
  it('ubica cada estado en su columna', () => {
    expect(columnaFlujo(fila({ entidad: 'envasado', estado: 'cola' }))).toBe('para_envasar')
    expect(columnaFlujo(fila({ estado: 'pausada' }))).toBe('fabricando')
    expect(columnaFlujo(fila({ entidad: 'fraccionado', estado: 'activo' }))).toBe('fraccionado')
    expect(columnaFlujo(fila({ entidad: 'envasado', estado: 'finalizado' }))).toBe('terminadas')
    expect(columnaFlujo(fila({ estado: 'para_envasar' }))).toBe('para_envasar')
    expect(columnaFlujo(fila({ entidad: 'envasado', estado: 'pausado' }))).toBe('envasando')
  })

  it('columnas en el orden del kanban', () => {
    expect(COLUMNAS.map((c) => c.titulo)).toEqual([
      'Cola',
      'Fabricando',
      'Para envasar',
      'Envasando',
      'Fraccionado',
      'Terminadas hoy',
    ])
  })
})

describe('agruparFlujo', () => {
  it('en terminadas la más reciente va primero', () => {
    const vieja = fila({ estado: 'finalizada', fin: '2026-10-21T09:00:00Z' })
    const nueva = fila({ estado: 'finalizada', fin: '2026-10-21T11:00:00Z' })
    expect(agruparFlujo([vieja, nueva]).terminadas.map((f) => f.id)).toEqual([nueva.id, vieja.id])
  })
})

describe('kpisFlujo', () => {
  it('cuenta por columna y suma litros fabricados hoy', () => {
    const k = kpisFlujo([
      fila({ estado: 'finalizada', litros: 1000, fin: '2026-10-21T09:00:00Z' }),
      fila({ estado: 'finalizada', litros: 500, fin: '2026-10-21T10:00:00Z' }),
      fila({ estado: 'fabricando', corriendo: true }),
      fila({ estado: 'pausada' }),
      fila({ estado: 'cola' }),
      fila({ entidad: 'envasado', estado: 'activo', corriendo: true }),
    ])
    expect(k).toEqual({ cola: 1, fabricando: 2, envasando: 1, litrosHoy: 1500 })
  })
})
