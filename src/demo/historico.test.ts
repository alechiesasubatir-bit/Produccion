import { describe, expect, it } from 'vitest'
import type { FilaHistorial } from '../domain/historial'
import { porProducto, rankingOperarias, terminada, tiemposVsEstandar } from '../domain/kpis'
import { mesesHasta, productividadMensual, resumenProductividad } from '../domain/productividad'
import { generarHistorico } from './historico'
import { crearSimulador } from './simulador'

const HASTA = Date.parse('2026-11-25T09:00:00-03:00')
const filas = (semilla = 7) => generarHistorico({ hasta: HASTA, semilla, meses: 6 }) as unknown as FilaHistorial[]

describe('histórico de la demo (meses anteriores para KPIs y Productividad)', () => {
  it('cubre los 6 meses hasta ayer, solo días hábiles, todo terminado', () => {
    const f = filas()
    const dias = [...new Set(f.map((x) => x.dia!))].sort()
    expect(dias[0] >= '2026-06-01').toBe(true)
    expect(dias[0] <= '2026-06-03').toBe(true)
    expect(dias[dias.length - 1]).toBe('2026-11-24')
    for (const d of dias) expect([0, 6]).not.toContain(new Date(`${d}T12:00:00Z`).getUTCDay())
    expect(f.every((x) => terminada(x))).toBe(true)
    expect(new Set(f.map((x) => x.id)).size).toBe(f.length)
  })

  it('la misma semilla da el mismo histórico', () => {
    expect(filas(3)).toEqual(filas(3))
    expect(filas(3)).not.toEqual(filas(4))
  })

  it('Productividad compara 6 meses con datos, y hay operarias que mejoran y que empeoran', () => {
    const meses = mesesHasta('2026-11-25', 6)
    const grupos = productividadMensual(filas(), meses)
    expect(grupos.length).toBeGreaterThan(3)
    expect(grupos[0].equipo.every((c) => c !== null)).toBe(true)
    const r = resumenProductividad(grupos, meses)
    expect(r.horasAntes).toBeGreaterThan(0)
    expect(r.mejoraron).toBeGreaterThan(0)
    expect(r.empeoraron).toBeGreaterThan(0)
    expect(r.ranking.length).toBeGreaterThan(5)
  })

  it('alimenta Ranking, Productos y Tiempos vs. estándar', () => {
    const f = filas()
    expect(rankingOperarias(f).length).toBeGreaterThan(5)
    expect(porProducto(f).length).toBeGreaterThan(3)
    const sim = crearSimulador({ inicio: HASTA, semilla: 1, calentar: 0, autonomo: false })
    const tiempos = tiemposVsEstandar(f, sim.consultar('v_tiempos_estandar') as never)
    expect(tiempos.length).toBeGreaterThan(3)
    expect(tiempos.every((t) => t.estandar !== null && t.desvioPct !== null)).toBe(true)
  })

  it('el simulador lo suma a v_historial solo si se pide', () => {
    const sin = crearSimulador({ inicio: HASTA, semilla: 1, calentar: 0, autonomo: false })
    const con = crearSimulador({ inicio: HASTA, semilla: 1, calentar: 0, autonomo: false, mesesHistorico: 6 })
    const antes = (s: typeof sin) => s.consultar('v_historial').filter((x) => String(x.dia) < '2026-11-25')
    expect(antes(sin)).toEqual([])
    expect(antes(con).length).toBeGreaterThan(500)
  })
})
