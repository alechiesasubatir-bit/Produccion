import { describe, expect, it } from 'vitest'
import { aCSV } from './csv'

describe('aCSV', () => {
  const columnas = [
    { titulo: 'Producto', valor: (f: { p: string; n: number | null }) => f.p },
    { titulo: 'Litros', valor: (f: { p: string; n: number | null }) => f.n },
  ]

  it('BOM, separador ; y decimales con coma', () => {
    const csv = aCSV(columnas, [{ p: 'Lavandina', n: 1.5 }])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual(['Producto;Litros', 'Lavandina;1,5'])
  })

  it('escapa ;, comillas y saltos de línea; null queda vacío', () => {
    const csv = aCSV(columnas, [{ p: 'Cloro; "fuerte"\nx', n: null }])
    expect(csv.slice(1).split('\r\n')[1]).toBe('"Cloro; ""fuerte""\nx";')
  })
})
