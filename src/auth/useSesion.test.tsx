import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SesionProvider, useSesion } from './useSesion'

const respuestas: Array<{ data: unknown; error: unknown }> = []

vi.mock('../lib/supabase', () => {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: () => Promise.resolve(respuestas.shift() ?? { data: null, error: null }),
  }
  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => consulta,
    },
  }
})

function Mostrar() {
  const s = useSesion()
  return <p>{s.cargando ? 'cargando' : `rol=${s.rol} error=${s.errorPerfil}`}</p>
}

describe('SesionProvider', () => {
  it('si falla la lectura del perfil lo marca como error y reintenta al volver la red', async () => {
    respuestas.push(
      { data: null, error: { message: 'Failed to fetch' } },
      { data: { rol: 'admin', rol_produccion: null, activo: true }, error: null },
    )
    render(
      <SesionProvider>
        <Mostrar />
      </SesionProvider>,
    )
    await waitFor(() => expect(screen.getByText('rol=null error=true')).toBeInTheDocument(), { timeout: 3000 })
    // dejar que corra el efecto que registra el listener de 'online' antes de disparar el evento
    await act(async () => {})
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(screen.getByText('rol=panel error=false')).toBeInTheDocument(), { timeout: 3000 })
  })
})
