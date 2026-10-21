import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInactividad } from './useInactividad'

describe('useInactividad', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('expira una vez a los 30 s sin interacción', () => {
    const alExpirar = vi.fn()
    renderHook(() => useInactividad(true, 30_000, alExpirar))
    act(() => vi.advanceTimersByTime(29_900))
    expect(alExpirar).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(500))
    expect(alExpirar).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(60_000))
    expect(alExpirar).toHaveBeenCalledTimes(1)
  })

  it('un toque reinicia el plazo', () => {
    const alExpirar = vi.fn()
    renderHook(() => useInactividad(true, 30_000, alExpirar))
    act(() => vi.advanceTimersByTime(20_000))
    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
    })
    act(() => vi.advanceTimersByTime(25_000))
    expect(alExpirar).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(5_500))
    expect(alExpirar).toHaveBeenCalledTimes(1)
  })

  it('devuelve la fracción restante', () => {
    const { result } = renderHook(() => useInactividad(true, 30_000, () => {}))
    act(() => vi.advanceTimersByTime(15_000))
    expect(result.current).toBeGreaterThan(0.48)
    expect(result.current).toBeLessThan(0.52)
  })

  it('inactivo no expira y devuelve 1', () => {
    const alExpirar = vi.fn()
    const { result } = renderHook(() => useInactividad(false, 30_000, alExpirar))
    act(() => vi.advanceTimersByTime(60_000))
    expect(alExpirar).not.toHaveBeenCalled()
    expect(result.current).toBe(1)
  })
})
