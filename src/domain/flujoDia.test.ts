import { describe, expect, it } from 'vitest'
import type { FilaFlujo } from './flujo'
import { grupoTanque, resumenDia, tanquesPorGrupo } from './flujoDia'

let n = 0
const fila = (over: Partial<FilaFlujo>): FilaFlujo =>
  ({
    entidad: 'fabricacion', id: `f${++n}`, estado: 'fabricando', producto: 'Lavandina', color: null, tanque_codigo: 'T-01', presentacion: null,
    cantidad: null, litros: 1000, lote: null, descripcion: null, operaria_1: null, operaria_2: null, listo: true, inicio: null, min_efectivos: null,
    corriendo: true, created_at: '2026-11-20T10:00:00Z', fin: null, fabricacion_id: null, litros_restantes: null, producto_tipo: null, operarias: [],
    etiqueta: null, control_intento: null, control_rechazo: null, lote_doc: null, granel_id: null, origen: null, ...over,
  }) as FilaFlujo

describe('resumenDia', () => {
  it('suma lo terminado hoy por hora de Montevideo y lista quién trabaja ahora, una vez cada una', () => {
    const r = resumenDia([
      fila({ estado: 'finalizada', fin: '2026-11-20T12:30:00Z', min_efectivos: 90 }), // 9:30
      fila({ estado: 'finalizada', fin: '2026-11-20T12:50:00Z', litros: 500, origen: 'stock' }), // stock: no suma litros
      fila({ entidad: 'envasado', estado: 'finalizado', fin: '2026-11-20T17:10:00Z', cantidad: 200, presentacion: '5L', fabricacion_id: 'x' }), // 14:10
      fila({ operarias: [{ empleado_id: 'A', nombre: 'Ana', desde: '2026-11-20T11:00:00Z' }] }),
      fila({ entidad: 'envasado', estado: 'activo', fabricacion_id: 'x', cantidad: 50, presentacion: '1L', operarias: [{ empleado_id: 'A', nombre: 'Ana', desde: '2026-11-20T13:00:00Z' }, { empleado_id: 'B', nombre: 'Bea', desde: '2026-11-20T12:00:00Z' }] }),
    ])
    expect(r).toMatchObject({ litros: 1000, unidades: 200, terminadas: 3, minutosEfectivos: 90 })
    expect(r.porHora[0].hora).toBe(6)
    expect(r.porHora.find((h) => h.hora === 9)).toEqual({ hora: 9, litros: 1000, unidades: 0, terminadas: 2 })
    expect(r.porHora.find((h) => h.hora === 14)?.unidades).toBe(200)
    expect(r.trabajando.map((t) => [t.nombre, t.tarea])).toEqual([
      ['Bea', 'Lavandina · 50 × 1L'],
      ['Ana', 'Lavandina · 50 × 1L'],
    ])
  })
})

describe('tanques', () => {
  it('agrupa los estados en trabajando, esperando, en pausa y libres', () => {
    expect(grupoTanque('en_control')).toBe('esperando')
    expect(tanquesPorGrupo(['libre', 'fabricando', 'envasando', 'env_pausado', 'cola_env', 'libre'])).toEqual({ trabajando: 2, esperando: 1, pausados: 1, libres: 2 })
  })
})
