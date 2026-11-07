import { describe, expect, it } from 'vitest'
import { aNumero, buscarEnCatalogo, coincidir, normalizarNombre } from './escaneo'

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

describe('coincidir', () => {
  it('parcial: elige la más específica y marca que no es exacta', () => {
    const c = coincidir('CLORO GEL 5%', [{ id: 'c1', nombre: 'Cloro' }, { id: 'c2', nombre: 'Cloro gel' }])
    expect(c).toEqual({ item: { id: 'c2', nombre: 'Cloro gel' }, exacta: false })
  })
  it('varias igual de específicas: devuelve las ambiguas', () => {
    const lista = [
      { id: 'f1', nombre: 'Lavandina' },
      { id: 'f2', nombre: 'Lavandina' },
    ]
    expect(coincidir('Lavandina', lista)).toEqual({ ambiguas: lista })
    expect(buscarEnCatalogo('Lavandina', lista)).toBeNull()
  })
})
