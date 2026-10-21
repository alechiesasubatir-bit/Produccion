import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApp } from './PanelApp'

vi.mock('./Flujo', () => ({ Flujo: () => <p>vista flujo</p> }))
vi.mock('./Tanques', () => ({ Tanques: () => <p>vista tanques</p> }))
vi.mock('./config/Configuracion', () => ({ Configuracion: () => <p>vista configuración</p> }))
vi.mock('./monitor/Monitor', () => ({ Monitor: ({ salir }: { salir: string }) => <p>vista monitor (salir a {salir})</p> }))
vi.mock('../demo/BarraDemo', () => ({ BarraDemo: () => <p>controles de la demo</p> }))
vi.mock('./alertas/useAlertas', () => ({ useAlertas: () => ({ todas: [], activas: [{ id: 'a' }, { id: 'b' }], recargar: vi.fn() }) }))
vi.mock('./alertas/useAvisoSonoro', () => ({ useAvisoSonoro: () => {} }))
vi.mock('../auth/useSesion', () => ({ useSesion: () => ({ usuario: { email: 'enc@x.uy' } }), salir: vi.fn() }))

function montar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/panel/*" element={<PanelApp />} />
        <Route path="/demo/*" element={<PanelApp base="/demo" demo />} />
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

  it('se llama Control de Producción', () => {
    montar('/panel')
    expect(screen.getByText('Control de Producción')).toBeInTheDocument()
  })

  it('después de Configuración vienen Monitor y DEMO; DEMO abre la demo en otra pestaña', () => {
    montar('/panel')
    const nombres = screen.getAllByRole('link').map((l) => l.textContent)
    expect(nombres.slice(-3)).toEqual(['Configuración', 'Monitor', 'DEMO'])
    const demo = screen.getByRole('link', { name: 'DEMO' })
    expect(demo).toHaveAttribute('href', '/demo')
    expect(demo).toHaveAttribute('target', '_blank')
  })

  it('en /panel/monitor muestra el monitor, que vuelve al panel', () => {
    montar('/panel/monitor')
    expect(screen.getByText('vista monitor (salir a /panel)')).toBeInTheDocument()
  })

  it('en la demo: solo Flujo, Tanques y Monitor, con los controles de la demo y sin usuario', () => {
    montar('/demo/tanques')
    expect(screen.getByText('vista tanques')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Flujo', 'Tanques', 'Monitor'])
    expect(screen.getByRole('link', { name: 'Tanques' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('controles de la demo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument()
  })
})
