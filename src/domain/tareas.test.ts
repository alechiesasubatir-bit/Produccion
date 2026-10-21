import { describe, expect, it } from 'vitest'
import {
  clasificarTareas,
  confirmacionPanel,
  estadoOperaria,
  etiquetaPanel,
  etiquetaAccion,
  formatoCronometro,
  pasadoAccion,
  segundosTranscurridos,
  tituloTarea,
  type Tarea,
} from './tareas'

let n = 0
function tarea(over: Partial<Tarea> = {}): Tarea {
  n += 1
  return {
    entidad: 'fabricacion',
    id: `t${n}`,
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
    ...over,
  }
}

describe('clasificarTareas', () => {
  it('una tarea donde soy operaria_2 es mía', () => {
    const t = tarea({ entidad: 'envasado', estado: 'activo', operaria_1: 'E2', operaria_2: 'E1' })
    expect(clasificarTareas([t], 'E1').mias).toEqual([t])
  })

  it('una cola que todavía no está lista no es disponible', () => {
    const t = tarea({ entidad: 'envasado', listo: false })
    expect(clasificarTareas([t], 'E1').disponibles).toEqual([])
  })

  it('una cola preasignada a otra operaria no es disponible', () => {
    const t = tarea({ operaria_1: 'E2' })
    expect(clasificarTareas([t], 'E1').disponibles).toEqual([])
  })

  it('las del tanque del QR van primero aunque sean más nuevas', () => {
    const vieja = tarea({ tanque_codigo: 'T-01' })
    const delQr = tarea({ tanque_codigo: 'T-03' })
    expect(clasificarTareas([vieja, delQr], 'E1', 'T-03').disponibles.map((t) => t.id)).toEqual([delQr.id, vieja.id])
  })
})

describe('estadoOperaria', () => {
  it('trabajando si tiene alguna corriendo', () => {
    const ts = [
      tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E1' }),
      tarea({ estado: 'pausada', operaria_1: 'E1' }),
    ]
    expect(estadoOperaria(ts, 'E1')).toBe('trabajando')
  })
  it('pausada si solo tiene pausadas', () => {
    expect(estadoOperaria([tarea({ estado: 'pausado', entidad: 'envasado', operaria_1: 'E1' })], 'E1')).toBe('pausada')
  })
  it('null si no tiene nada', () => {
    expect(estadoOperaria([tarea()], 'E1')).toBeNull()
  })
})

describe('cronómetro', () => {
  it('suma lo transcurrido desde la carga si está corriendo', () => {
    expect(segundosTranscurridos({ min_efectivos: 2, corriendo: true }, 0, 5000)).toBe(125)
    expect(segundosTranscurridos({ min_efectivos: 2, corriendo: false }, 0, 5000)).toBe(120)
    expect(segundosTranscurridos({ min_efectivos: null, corriendo: false }, 0, 5000)).toBe(0)
  })
  it('formato', () => {
    expect(formatoCronometro(65)).toBe('01:05')
    expect(formatoCronometro(3725)).toBe('1:02:05')
  })
})

describe('textos', () => {
  it('etiquetas y pasado', () => {
    expect(etiquetaAccion('iniciar', true)).toBe('Tomar')
    expect(etiquetaAccion('iniciar', false)).toBe('Iniciar')
    expect(pasadoAccion('finalizar')).toBe('finalizaste')
  })
  it('título de envasado', () => {
    expect(tituloTarea(tarea({ entidad: 'envasado', producto: 'Lavandina', cantidad: 120, presentacion: '5L' }))).toBe(
      'Lavandina · 120 × 5L',
    )
  })
})

describe('acciones del panel', () => {
  it('finalizar una fabricación que espera envasado es cerrar con merma, y lo confirma con su consecuencia', () => {
    expect(etiquetaPanel('fabricacion', 'para_envasar', 'finalizar')).toBe('Cerrar con merma')
    expect(confirmacionPanel('fabricacion', 'para_envasar', 'finalizar')).toBe('¿Cerrar sin envasar?')
  })

  it('el resto de las acciones conserva su nombre y su "¿Seguro?"', () => {
    expect(etiquetaPanel('fabricacion', 'fabricando', 'finalizar')).toBe('Finalizar')
    expect(etiquetaPanel('envasado', 'activo', 'finalizar')).toBe('Finalizar')
    expect(confirmacionPanel('fabricacion', 'cola', 'cancelar')).toBe('¿Seguro?')
  })
})
