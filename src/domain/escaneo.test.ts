import { describe, expect, it } from 'vitest'
import { aNumero, aplicarEscaneo, buscarEnCatalogo, normalizarNombre, normalizarPresentacion } from './escaneo'

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

describe('aplicarEscaneo', () => {
  const cat = {
    productos: [{ id: 'p1', nombre: 'Lavandina' }],
    presentaciones: [{ id: 'pr1', nombre: '5L' }],
    tanquesEnvasar: [{ fabricacion_id: 'fab3', producto: 'Lavandina', codigo: 'T-03' }],
  }

  it('fabricación: producto del catálogo, litros sin multiplicar y lote', () => {
    const r = aplicarEscaneo('fabricacion', { producto: 'LAVANDINA', cantidad: '3,000.000', lote: '123', fecha: '21/10/2026' }, cat)
    expect(r.campos).toEqual({ producto_id: 'p1', litros: 3000, lote: '123' })
    expect(r.avisos).toEqual([])
  })

  it('producto desconocido: aviso y sin precargar', () => {
    const r = aplicarEscaneo('fabricacion', { producto: 'Detergente X', cantidad: 500, lote: '9', fecha: '' }, cat)
    expect(r.campos.producto_id).toBeUndefined()
    expect(r.avisos).toContain('No encontré «Detergente X» en productos.')
  })

  it('envasado: tanque por el granel, presentación normalizada y aviso si hay varias', () => {
    const r = aplicarEscaneo(
      'envasado',
      {
        granel: 'Lavandina',
        fecha: '',
        presentaciones: [
          { nombre: 'x 5 L', cantidad: 120 },
          { nombre: '1 lt', cantidad: 50 },
        ],
      },
      cat,
    )
    expect(r.campos).toEqual({ fabricacion_id: 'fab3', presentacion_id: 'pr1', cantidad: 120 })
    expect(r.avisos).toContain('La hoja trae 2 presentaciones; cargá una orden por cada una.')
  })
})
