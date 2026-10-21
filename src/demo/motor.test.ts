import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearMotor } from './motor'

describe('motor de la demo', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a 60× avanza un minuto simulado por segundo y avisa a los suscriptos', () => {
    const m = crearMotor({ semilla: 2 })
    const aviso = vi.fn()
    m.suscribir(aviso)
    const t0 = m.ahora()
    vi.advanceTimersByTime(3000)
    expect(m.ahora() - t0).toBe(3 * 60_000)
    expect(aviso).toHaveBeenCalledTimes(3)
    m.detener()
  })

  it('a 1× (tiempo real) junta segundos hasta completar un minuto', () => {
    const m = crearMotor({ semilla: 2 })
    m.setVelocidad(1)
    const t0 = m.ahora()
    vi.advanceTimersByTime(59_000)
    expect(m.ahora()).toBe(t0)
    vi.advanceTimersByTime(1000)
    expect(m.ahora() - t0).toBe(60_000)
    m.detener()
  })

  it('en pausa no avanza; reiniciar arma otra planta y avisa', () => {
    const m = crearMotor({ semilla: 2 })
    m.setVelocidad(0)
    const t0 = m.ahora()
    vi.advanceTimersByTime(5000)
    expect(m.ahora()).toBe(t0)
    const aviso = vi.fn()
    const baja = m.suscribir(aviso)
    m.reiniciar()
    expect(aviso).toHaveBeenCalled()
    baja()
    m.setVelocidad(60)
    vi.advanceTimersByTime(1000)
    expect(aviso).toHaveBeenCalledTimes(1)
    m.detener()
  })
})
