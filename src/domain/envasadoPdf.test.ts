import { describe, expect, it } from 'vitest'
import type { Fragmento } from './formulaPdf'
import { leerEnvasados, presentacionDe, tipoDeHoja } from './envasadoPdf'
import bactipro from './__fixtures__/bactipro.json'
import envasado from './__fixtures__/envasado-limpiador.json'
import fraccionado from './__fixtures__/fraccionado-polvo.json'

const frFormula = bactipro as Fragmento[]
const frEnvasado = envasado as Fragmento[]
const frFraccionado = fraccionado as Fragmento[]

describe('leerEnvasados', () => {
  it('lee una hoja de tres bloques con granel, consumibles y producto terminado', () => {
    const r = leerEnvasados(frEnvasado)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.documentos).toHaveLength(1)
    const d = r.documentos[0]
    expect(d.lote).toBe('99001')
    expect(d.fecha).toBe('2026-11-09')
    expect(d.bloques).toHaveLength(3)
    const [a, b, c] = d.bloques
    expect(a).toEqual({
      tipo: 'envasado',
      granel: { codigo: 'F9', nombre: 'Limpiador Prueba', litros: 900 },
      producto: { codigo: '900301', descripcion: 'Limpiador Prueba x 1.5 L', cantidad: 600 },
      presentacion: '1.5L',
      consumibles: [
        { codigo: '900201', descripcion: 'Botella Prueba x 1.500 cc (40g)', cantidad: 600 },
        { codigo: '900202', descripcion: 'Tapas Prueba Rosca 28 (Caja)', cantidad: 600 },
        { codigo: '900203', descripcion: 'Etiqueta Prueba Mediana X UNIDAD', cantidad: 600 },
      ],
    })
    expect(b.granel).toEqual({ codigo: 'F9', nombre: 'Limpiador Prueba', litros: 500 })
    expect(b.producto).toEqual({ codigo: '900302', descripcion: 'Limpiador Prueba x 5 L', cantidad: 100 })
    expect(b.presentacion).toBe('5L')
    expect(b.consumibles.map((x) => [x.codigo, x.cantidad])).toEqual([['900204', 100], ['900205', 100]])
    expect(c.granel?.litros).toBe(1800)
    expect(c.producto.cantidad).toBe(180)
    expect(c.presentacion).toBe('10L')
  })

  it('hoja de fraccionado: sin F, la MP, el pote y la etiqueta son consumibles', () => {
    const r = leerEnvasados(frFraccionado)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.documentos[0].lote).toBe('99002')
    expect(r.documentos[0].bloques).toEqual([
      {
        tipo: 'fraccionado',
        granel: null,
        producto: { codigo: '900501', descripcion: 'Polvo Prueba pote x 1/2 Kg', cantidad: 120 },
        presentacion: '500g',
        consumibles: [
          { codigo: '900401', descripcion: 'Carga Mineral Prueba (Materia Prima) Polvo', cantidad: 60 },
          { codigo: '900402', descripcion: 'Pote Prueba x 500 grs. (50g)', cantidad: 120 },
          { codigo: '900403', descripcion: 'Etiqueta Prueba Chica X UNIDAD', cantidad: 120 },
        ],
      },
    ])
  })

  it('un consumible con cantidad cero se descarta', () => {
    const i = frEnvasado.findIndex((f) => f.str === '900202')
    const cero = frEnvasado.map((f, k) => (k > i && f.str === '(600.000)' && f.y === frEnvasado[i].y ? { ...f, str: '(0.000)' } : f))
    const r = leerEnvasados(cero)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.documentos[0].bloques[0].consumibles.map((x) => x.codigo)).toEqual(['900201', '900203'])
  })

  it('descripción partida en dos renglones: cada código conserva su cantidad', () => {
    const i = frEnvasado.findIndex((f) => f.str === '900202')
    const y = frEnvasado[i].y
    const conCorte: Fragmento[] = [
      ...frEnvasado.slice(0, i),
      { str: 'continuación', x: 156, y: y + 10, pagina: 1 },
      ...frEnvasado.slice(i),
    ]
    const r = leerEnvasados(conCorte)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const bloque = r.documentos[0].bloques[0]
    expect(bloque.consumibles.map((x) => [x.codigo, x.cantidad])).toEqual([
      ['900201', 600],
      ['900202', 600],
      ['900203', 600],
    ])
    expect(bloque.consumibles[0].descripcion).toContain('continuación')
    expect(r.documentos[0].bloques).toHaveLength(3)
  })

  it('cierre con la descripción partida en dos renglones: sigue siendo un solo cierre', () => {
    const i = frEnvasado.findIndex((f) => f.str === '900301')
    const y = frEnvasado[i].y
    const conCorte: Fragmento[] = [
      ...frEnvasado,
      { str: 'segundo renglón', x: 156, y: y - 9, pagina: 1 },
    ]
    const r = leerEnvasados(conCorte)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.documentos[0].bloques).toHaveLength(3)
    expect(r.documentos[0].bloques[0].producto.cantidad).toBe(600)
    expect(r.documentos[0].bloques[0].producto.descripcion).toContain('segundo renglón')
  })

  it('dos comprobantes en un PDF: un documento por lote', () => {
    const pagina2 = frFraccionado.map((f) => ({ ...f, pagina: 2 }))
    const r = leerEnvasados([...frEnvasado, ...pagina2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.documentos.map((d) => [d.lote, d.bloques.length])).toEqual([
      ['99001', 3],
      ['99002', 1],
    ])
  })

  it('un bloque sin cierre al final de la tabla se descarta', () => {
    // Se quita el renglón de cierre del último bloque (código, descripción y cantidad).
    const ultimoCierre = frEnvasado.find((f) => f.str === '900303')!.y
    const r = leerEnvasados(frEnvasado.filter((f) => Math.abs(f.y - ultimoCierre) > 1))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.documentos[0].bloques).toHaveLength(2)
  })

  it('una fórmula no es una hoja de envasado', () => {
    const r = leerEnvasados(frFormula)
    expect(r.ok).toBe(false)
  })

  it('PDF vacío o ajeno: error', () => {
    expect(leerEnvasados([]).ok).toBe(false)
    expect(leerEnvasados([{ str: 'hola', x: 1, y: 1, pagina: 1 }]).ok).toBe(false)
  })

  it('un comprobante con renglón de fórmula y de envasado a la vez se trata como fórmula', () => {
    const mezcla: Fragmento[] = [
      ...frFormula,
      // renglón numérico sin paréntesis (cierre) agregado a la fórmula
      { str: '900301', x: 51, y: 622, pagina: 1 },
      { str: 'Limpiador Prueba x 1.5 L', x: 156, y: 622, pagina: 1 },
      { str: '600.000', x: 116.4, y: 622, pagina: 1 },
    ]
    expect(tipoDeHoja(mezcla)).toBe('formula')
    expect(leerEnvasados(mezcla).ok).toBe(false)
  })
})

describe('tipoDeHoja', () => {
  it('distingue fórmula, envasado y desconocido', () => {
    expect(tipoDeHoja(frFormula)).toBe('formula')
    expect(tipoDeHoja(frEnvasado)).toBe('envasado')
    expect(tipoDeHoja(frFraccionado)).toBe('envasado')
    expect(tipoDeHoja([])).toBeNull()
    expect(tipoDeHoja([{ str: 'hola', x: 1, y: 1, pagina: 1 }])).toBeNull()
  })
})

describe('presentacionDe', () => {
  it.each([
    ['Limpiador Prueba x 1.5 L', '1.5L'],
    ['Limpiador Prueba x 5 L', '5L'],
    ['Limpiador Prueba x 10 L', '10L'],
    ['Polvo Prueba pote x 1/2 Kg', '500g'],
    ['Polvo Prueba x 1/4 kg', '250g'],
    ['Polvo Prueba x 500 grs.', '500g'],
    ['Polvo Prueba x 1 Kg', '1kg'],
    ['Polvo Prueba x 900g', '900g'],
    ['Producto sin presentación', null],
    ['', null],
  ])('%s → %s', (desc, esperado) => {
    expect(presentacionDe(desc)).toBe(esperado)
  })
})
