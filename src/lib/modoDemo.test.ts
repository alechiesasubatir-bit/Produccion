import { describe, expect, it } from 'vitest'
import { esRutaDemo } from './modoDemo'

describe('esRutaDemo', () => {
  it('reconoce /demo y sus subrutas bajo la base de Pages', () => {
    expect(esRutaDemo('/Produccion/demo', '/Produccion/')).toBe(true)
    expect(esRutaDemo('/Produccion/demo/monitor', '/Produccion/')).toBe(true)
    expect(esRutaDemo('/Produccion/panel', '/Produccion/')).toBe(false)
    expect(esRutaDemo('/Produccion/demolicion', '/Produccion/')).toBe(false)
  })
})
