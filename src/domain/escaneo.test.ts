import { describe, expect, it } from 'vitest'
import { aNumero, buscarEnCatalogo, normalizarNombre, normalizarPresentacion } from './escaneo'

describe('aNumero (Macrosoft: coma = miles, punto = decimal)', () => {
  it('nunca multiplica por 1000', () => {
    expect(aNumero('1,000.000')).toBe(1000)
    expect(aNumero('3,000.000')).toBe(3000)
    expect(aNumero('800.000')).toBe(800)
    expect(aNumero('12.5')).toBe(12.5)
    expect(aNumero(3000)).toBe(3000)
  })
  it('valores inválidos → null', () => {
    expect(aNumero('')).toBeNull()
    expect(aNumero('abc')).toBeNull()
    expect(aNumero(null)).toBeNull()
  })
})

describe('catálogo', () => {
  const productos = [
    { id: 'p1', nombre: 'Lavandina concentrada' },
    { id: 'p2', nombre: 'Cloro' },
  ]
  it('busca sin mayúsculas, tildes ni espacios de más', () => {
    expect(normalizarNombre('  LAVANDÍNA   Concentrada ')).toBe('lavandina concentrada')
    expect(buscarEnCatalogo('LAVANDINA CONCENTRADA', productos)?.id).toBe('p1')
  })
  it('si no hay exacto, uno que lo contenga', () => {
    expect(buscarEnCatalogo('Cloro 1L', productos)?.id).toBe('p2')
  })
  it('producto inexistente → null', () => {
    expect(buscarEnCatalogo('Detergente', productos)).toBeNull()
  })
})

describe('normalizarPresentacion', () => {
  it('equivalencias de la app vieja', () => {
    expect(normalizarPresentacion('x 5 L')).toBe('5L')
    expect(normalizarPresentacion('1/2 kg')).toBe('500g')
    expect(normalizarPresentacion('1/4 kg')).toBe('250g')
    expect(normalizarPresentacion('1 lt')).toBe('1L')
  })
})
