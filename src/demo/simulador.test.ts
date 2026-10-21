import { describe, expect, it } from 'vitest'
import { columnaFlujo, type FilaFlujo } from '../domain/flujo'
import { TANQUES } from './catalogo'
import { crearSimulador } from './simulador'

const INICIO = Date.parse('2026-10-21T09:00:00-03:00')
type Tanque = { tanque_id: string; codigo: string; estado: string; fabricacion_id: string | null; litros: number | null; litros_restantes: number | null }

const tanques = (s: ReturnType<typeof crearSimulador>) => s.consultar('v_tanque_estado') as Tanque[]
const flujo = (s: ReturnType<typeof crearSimulador>) => s.consultar('v_flujo') as FilaFlujo[]

describe('simulador de la demo', () => {
  it('arranca con casi todos los tanques en producción y todas las columnas del flujo con algo', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 7 })
    const ocupados = tanques(s).filter((t) => t.estado !== 'libre')
    expect(tanques(s)).toHaveLength(TANQUES.length)
    expect(ocupados.length).toBeGreaterThanOrEqual(TANQUES.length - 3)
    const columnas = new Set(flujo(s).map(columnaFlujo))
    for (const c of ['cola', 'fabricando', 'para_envasar', 'envasando', 'fraccionado', 'terminadas']) {
      expect(columnas, c).toContain(c)
    }
  })

  it('con la misma semilla da exactamente lo mismo', () => {
    const a = crearSimulador({ inicio: INICIO, semilla: 3 })
    const b = crearSimulador({ inicio: INICIO, semilla: 3 })
    a.avanzar(90)
    b.avanzar(90)
    expect(flujo(a)).toEqual(flujo(b))
  })

  it('el reloj simulado avanza un minuto por minuto simulado', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 1, calentar: 0 })
    s.avanzar(30)
    expect(s.ahora() - INICIO).toBe(30 * 60_000)
  })

  it('una fabricación recorre cola → fabricando → para envasar → envasado → finalizada y libera el tanque', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 11, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt1', producto_id: 'dp1', litros: 400, lote: 'L-1' })
    const id = flujo(s).find((f) => f.lote === 'L-1')!.id
    expect(s.accion('fabricacion', id, 'iniciar')).toMatchObject({ ok: true })
    s.avanzar(25) // 400 L a 20 L/min = 20 min
    expect(flujo(s).find((f) => f.id === id)?.estado).toBe('para_envasar')
    s.insertar('envasados', { fabricacion_id: id, presentacion_id: 'dr4', cantidad: 80 }) // 80 × 5 L = 400 L
    const env = flujo(s).find((f) => f.entidad === 'envasado' && f.fabricacion_id === id)!
    expect(tanques(s).find((t) => t.tanque_id === 'dt1')?.estado).toBe('cola_env')
    s.accion('envasado', env.id, 'iniciar')
    expect(tanques(s).find((t) => t.tanque_id === 'dt1')?.estado).toBe('envasando')
    s.avanzar(30)
    expect(flujo(s).find((f) => f.id === env.id)?.estado).toBe('finalizado')
    expect(flujo(s).find((f) => f.id === id)?.estado).toBe('finalizada')
    expect(tanques(s).find((t) => t.tanque_id === 'dt1')?.estado).toBe('libre')
  })

  it('el tanque baja mientras se envasa', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 11, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt2', producto_id: 'dp2', litros: 1000, lote: 'L-2' })
    const id = flujo(s).find((f) => f.lote === 'L-2')!.id
    s.accion('fabricacion', id, 'iniciar')
    s.avanzar(55)
    s.insertar('envasados', { fabricacion_id: id, presentacion_id: 'dr4', cantidad: 200 })
    const env = flujo(s).find((f) => f.entidad === 'envasado')!
    s.accion('envasado', env.id, 'iniciar')
    s.avanzar(10)
    const t = tanques(s).find((x) => x.tanque_id === 'dt2')!
    expect(t.litros).toBe(1000)
    expect(t.litros_restantes).toBeLessThan(1000)
    expect(t.litros_restantes).toBeGreaterThan(0)
  })

  it('pausar detiene el avance y reanudar lo continúa; las acciones inválidas se rechazan', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 5, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt3', producto_id: 'dp3', litros: 600, lote: 'L-3' })
    const id = flujo(s).find((f) => f.lote === 'L-3')!.id
    expect(s.accion('fabricacion', id, 'pausar')).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
    s.accion('fabricacion', id, 'iniciar')
    s.avanzar(5)
    s.accion('fabricacion', id, 'pausar')
    s.avanzar(60)
    const pausada = flujo(s).find((f) => f.id === id)!
    expect(pausada.estado).toBe('pausada')
    expect(pausada.min_efectivos).toBe(5)
    s.accion('fabricacion', id, 'reanudar')
    s.avanzar(3)
    expect(flujo(s).find((f) => f.id === id)!.min_efectivos).toBe(8)
    expect(s.accion('fabricacion', 'no-existe', 'iniciar')).toMatchObject({ ok: false, codigo: 'NO_ENCONTRADO' })
  })

  it('no deja abrir dos fabricaciones en el mismo tanque', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 5, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt4', producto_id: 'dp4', litros: 500, lote: 'L-4' })
    expect(() => s.insertar('fabricaciones', { tanque_id: 'dt4', producto_id: 'dp4', litros: 500, lote: 'L-5' })).toThrow(
      /fabricaciones_tanque_abierta_uk/,
    )
  })

  it('solo, la planta no para: con el tiempo se terminan tareas y se arrancan nuevas', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 9 })
    const antes = new Set(flujo(s).map((f) => f.id))
    s.avanzar(240)
    const nuevas = flujo(s).filter((f) => !antes.has(f.id))
    expect(nuevas.length).toBeGreaterThan(3)
    expect(flujo(s).some((f) => f.corriendo)).toBe(true)
  })
})
