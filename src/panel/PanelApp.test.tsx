import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApp } from './PanelApp'

vi.mock('./Flujo', () => ({ Flujo: () => <p>vista flujo</p> }))
vi.mock('./Tanques', () => ({ Tanques: () => <p>vista tanques</p> }))
vi.mock('./config/Configuracion', () => ({ Configuracion: () => <p>vista configuración</p> }))
vi.mock('./alertas/useAlertas', () => ({ useAlertas: () => ({ todas: [], activas: [{ id: 'a' }, { id: 'b' }], recargar: vi.fn() }) }))
vi.mock('./alertas/useAvisoSonoro', () => ({ useAvisoSonoro: () => {} }))
vi.mock('../auth/useSesion', () => ({ useSesion: () => ({ usuario: { email: 'enc@x.uy' } }), salir: vi.fn() }))

function montar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/panel/*" element={<PanelApp />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PanelApp', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('muestra la vista de la ruta y marca su pestaña', () => {
    montar('/panel/tanques')
    expect(screen.getByText('vista tanques')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tanques' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Flujo' })).not.toHaveAttribute('aria-current')
  })

  it('en /panel muestra el flujo', () => {
    montar('/panel')
    expect(screen.getByText('vista flujo')).toBeInTheDocument()
  })

  it('sin red muestra la banda', async () => {
    montar('/panel')
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument()
  })

  it('la pestaña Alertas muestra cuántas hay activas', () => {
    montar('/panel')
    expect(screen.getByRole('link', { name: /Alertas/ })).toHaveTextContent('2')
  })
})
