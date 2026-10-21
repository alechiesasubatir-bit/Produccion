import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRealtime } from './useRealtime'

const mock = vi.hoisted(() => ({ estadoCanal: 'SUBSCRIBED' }))

vi.mock('./supabase', () => {
  const canal = {
    on: () => canal,
    subscribe: (cb: (estado: string) => void) => {
      cb(mock.estadoCanal)
      return canal
    },
  }
  return { supabase: { channel: () => canal, removeChannel: () => Promise.resolve() } }
})

function diferido<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>((r) => (resolver = r))
  return { promesa, resolver }
}

describe('useRealtime', () => {
  it('una respuesta vieja que llega tarde no pisa una más nueva', async () => {
    const lenta = diferido<string[]>()
    const rapida = diferido<string[]>()
    const respuestas = [lenta.promesa, rapida.promesa]
    const cargar = vi.fn(() => respuestas.shift() ?? Promise.resolve(['extra']))

    const { result } = renderHook(() => useRealtime('t', cargar, ['a']))

    // carga inicial (lenta) + recarga al quedar SUBSCRIBED (rápida, tras el debounce)
    await waitFor(() => expect(cargar).toHaveBeenCalledTimes(2))
    await act(async () => rapida.resolver(['nuevo']))
    await act(async () => lenta.resolver(['viejo']))

    expect(result.current.datos).toEqual(['nuevo'])
  })

  it('canal caído con red OK: enVivo=false pero conectado=true', async () => {
    mock.estadoCanal = 'CHANNEL_ERROR'
    const { result } = renderHook(() => useRealtime('t', () => Promise.resolve([1]), ['a']))
    await waitFor(() => expect(result.current.datos).toEqual([1]))
    expect(result.current.enVivo).toBe(false)
    expect(result.current.conectado).toBe(true)
    mock.estadoCanal = 'SUBSCRIBED'
  })

  it('offline/online cambia conectado y al volver recarga', async () => {
    const cargar = vi.fn(() => Promise.resolve([1]))
    const { result } = renderHook(() => useRealtime('t', cargar, []))
    await waitFor(() => expect(cargar).toHaveBeenCalled())
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.conectado).toBe(false)
    const antes = cargar.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current.conectado).toBe(true)
    expect(cargar.mock.calls.length).toBeGreaterThan(antes)
  })

  it('recargar() vuelve a cargar', async () => {
    const cargar = vi.fn(() => Promise.resolve([1]))
    const { result } = renderHook(() => useRealtime('t', cargar, []))
    await waitFor(() => expect(cargar).toHaveBeenCalled())
    const antes = cargar.mock.calls.length
    await act(async () => result.current.recargar())
    expect(cargar.mock.calls.length).toBe(antes + 1)
  })

  it('sin canales que escuchar, igual consulta cada 15 s', async () => {
    vi.useFakeTimers()
    const cargar = vi.fn(() => Promise.resolve([1]))
    renderHook(() => useRealtime('t', cargar, []))
    // pasar la recarga con debounce que dispara el SUBSCRIBED
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })
    const antes = cargar.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(15_100)
    })
    expect(cargar.mock.calls.length).toBeGreaterThan(antes)
    vi.useRealTimers()
  })
})
