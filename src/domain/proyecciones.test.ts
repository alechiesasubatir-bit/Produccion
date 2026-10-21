import { describe, expect, it } from 'vitest'
import { proyeccionEnvasado, proyeccionFabricacion, textoProyeccion } from './proyecciones'

describe('proyecciones', () => {
  it('fabricación: litros / velocidad', () => {
    expect(proyeccionFabricacion(600, { velocidad: 7.5 })).toBe(80)
    expect(proyeccionFabricacion(600, null)).toBeNull()
    expect(proyeccionFabricacion(0, { velocidad: 7.5 })).toBeNull()
  })
  it('envasado: unidades / velocidad, redondeado', () => {
    expect(proyeccionEnvasado(100, { velocidad: 3 })).toBe(33)
  })
  it('texto', () => {
    expect(textoProyeccion(80, 7.5, 'L')).toBe('~80 min (histórico 7,5 L/min)')
    expect(textoProyeccion(0.4, 20, 'u')).toBe('~1 min (histórico 20 u/min)')
  })
})
