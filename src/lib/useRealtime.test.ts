import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRealtime } from './useRealtime'

vi.mock('./supabase', () => {
  const canal = {
    on: () => canal,
    subscribe: (cb: (estado: string) => void) => {
      cb('SUBSCRIBED')
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
})
