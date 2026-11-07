import { describe, expect, it } from 'vitest'
import { leerFormulas, type Fragmento } from './formulaPdf'
import bactipro from './__fixtures__/bactipro.json'

const fr = bactipro as Fragmento[]

describe('leerFormulas', () => {
  it('lee la fórmula del PDF real (BACTIPRO)', () => {
    const r = leerFormulas(fr)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.formulas).toHaveLength(1)
    const f = r.formulas[0]
    expect(f.lote).toBe('17702')
    expect(f.fecha).toBe('2026-10-21')
    expect(f.granel).toEqual({ codigo: 'F8', nombre: 'Bactipro', litros: 1000 })
    expect(f.mp).toEqual([
      { codigo: '900101', descripcion: expect.stringContaining('Esencia Floral'), cantidad: 6.5 },
      { codigo: '900102', descripcion: expect.any(String), cantidad: 0.3 },
      { codigo: '900103', descripcion: expect.any(String), cantidad: 22.5 },
      { codigo: '900104', descripcion: expect.any(String), cantidad: 970.7 },
    ])
  })

  it('descripción en dos renglones: cada código conserva su cantidad', () => {
    // Un renglón extra (solo descripción) entre la primera y la segunda MP.
    const i = fr.findIndex((f) => f.str === '900102')
    const conCorte: Fragmento[] = [...fr.slice(0, i), { str: 'continuación de la descripción', x: 156, y: 711.4, pagina: 1 }, ...fr.slice(i)]
    const r = leerFormulas(conCorte)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const f = r.formulas[0]
    expect(f.granel).toEqual({ codigo: 'F8', nombre: 'Bactipro', litros: 1000 })
    expect(f.mp.map((m) => [m.codigo, m.cantidad])).toEqual([
      ['900101', 6.5],
      ['900102', 0.3],
      ['900103', 22.5],
      ['900104', 970.7],
    ])
    expect(f.mp[0].descripcion).toContain('continuación de la descripción')
    expect(f.mp[1].descripcion).toBe('Colorante Azul Prueba ( MP )')
  })

  it('la fecha de la fórmula es la de debajo de «FECHA», no la de «FECHA VENCIMIENTO»', () => {
    // El vencimiento completado va primero en el orden de extracción, debajo de su encabezado.
    const conVencimiento: Fragmento[] = [{ str: '21/10/2028', x: 385, y: 762, pagina: 1 }, ...fr]
    const r = leerFormulas(conVencimiento)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.formulas[0].fecha).toBe('2026-10-21')
  })

  it('si solo viene el vencimiento, la fecha de la fórmula queda vacía (se pide a mano)', () => {
    const soloVencimiento: Fragmento[] = [
      { str: '21/10/2028', x: 385, y: 762, pagina: 1 },
      ...fr.filter((f) => f.str !== '21/10/2026'),
    ]
    const r = leerFormulas(soloVencimiento)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.formulas[0].fecha).toBe('')
  })

  it('dos LOTE en páginas distintas → dos fórmulas en orden de página', () => {
    const pagina2: Fragmento[] = fr.map((f) => ({
      ...f,
      pagina: 2,
      str: f.str === '17702' ? '17703' : f.str,
    }))
    const r = leerFormulas([...fr, ...pagina2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.formulas).toHaveLength(2)
    expect(r.formulas[0].lote).toBe('17702')
    expect(r.formulas[1].lote).toBe('17703')
  })

  it('una página sin «LOTE» no rompe la lectura de las demás', () => {
    const paginaSinLote: Fragmento[] = [
      { str: 'Texto cualquiera', x: 10, y: 10, pagina: 2 },
      { str: 'Otro texto', x: 20, y: 20, pagina: 2 },
    ]
    const r = leerFormulas([...fr, ...paginaSinLote])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.formulas).toHaveLength(1)
  })

  it('sin fragmentos → error', () => {
    const r = leerFormulas([])
    expect(r).toEqual({ ok: false, error: 'Este PDF no tiene el formato de Movimientos de Produccion. Cargá la orden a mano.' })
  })

  it('sin ningún «LOTE» → error', () => {
    const r = leerFormulas([{ str: 'Texto cualquiera', x: 10, y: 10, pagina: 1 }])
    expect(r).toEqual({ ok: false, error: 'Este PDF no tiene el formato de Movimientos de Produccion. Cargá la orden a mano.' })
  })

  it('bloque sin fila de granel (F\\d+) se descarta; sin ninguno válido → error', () => {
    const sinGranel = fr.filter((f) => f.str !== 'F8' && f.str !== 'Bactipro (Granel)' && f.str !== '1,000.000')
    const r = leerFormulas(sinGranel)
    expect(r).toEqual({ ok: false, error: 'Este PDF no tiene el formato de Movimientos de Produccion. Cargá la orden a mano.' })
  })
})
