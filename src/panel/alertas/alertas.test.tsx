import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { separarAlertas, type Alerta } from '../../domain/alertas'
import { Alertas } from './Alertas'
import { useAvisoSonoro } from './useAvisoSonoro'

const m = vi.hoisted(() => ({ posponer: vi.fn(), marcarLeida: vi.fn(), sonar: vi.fn(), activado: true }))

vi.mock('./datosAlertas', () => ({ posponerAlerta: m.posponer, marcarLeida: m.marcarLeida }))
vi.mock('./sonido', () => ({
  sonarAlerta: m.sonar,
  sonidoActivado: () => m.activado,
  guardarSonido: vi.fn(),
}))

const alerta = (over: Partial<Alerta> = {}): Alerta => ({
  id: 'A1',
  tipo: 'exceso_9h',
  entidad: 'fabricacion',
  entidad_id: 'F1',
  texto: 'Fabricación de Lavandina en T-03 lleva más de 9 horas.',
  creada: '2026-10-15T10:00:00Z',
  leida: false,
  pospuesta_hasta: null,
  ...over,
})

const AHORA = new Date('2026-10-15T15:00:00Z')

describe('separarAlertas', () => {
  it('una pospuesta vencida vuelve a activas', () => {
    const r = separarAlertas(
      [alerta({ id: 'a', pospuesta_hasta: '2026-10-15T14:00:00Z' }), alerta({ id: 'b', pospuesta_hasta: '2026-10-15T16:00:00Z' }), alerta({ id: 'c', leida: true })],
      AHORA,
    )
    expect(r.activas.map((a) => a.id)).toEqual(['a'])
    expect(r.pospuestas.map((a) => a.id)).toEqual(['b'])
    expect(r.leidas.map((a) => a.id)).toEqual(['c'])
  })
})

describe('Alertas', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(AHORA)
    m.posponer.mockReset().mockResolvedValue({ error: null })
  })
  afterEach(() => vi.useRealTimers())

  it('posponer 4 horas guarda ahora + 4 h y la pasa a pospuestas', async () => {
    const recargar = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <Alertas todas={[alerta()]} recargar={recargar} />
      </MemoryRouter>,
    )
    const activas = screen.getByRole('region', { name: 'Activas' })
    await act(async () => fireEvent.click(within(activas).getByRole('button', { name: 'Posponer 4 horas' })))
    expect(m.posponer).toHaveBeenCalledWith('A1', '2026-10-15T19:00:00.000Z')
    expect(recargar).toHaveBeenCalled()
    rerender(
      <MemoryRouter>
        <Alertas todas={[alerta({ pospuesta_hasta: '2026-10-15T19:00:00.000Z' })]} recargar={recargar} />
      </MemoryRouter>,
    )
    expect(within(screen.getByRole('region', { name: 'Pospuestas y leídas' })).getByText(/más de 9 horas/)).toBeInTheDocument()
  })
})

describe('useAvisoSonoro', () => {
  beforeEach(() => {
    m.sonar.mockReset()
    m.activado = true
  })

  it('no suena con las alertas que ya estaban al cargar; suena una vez con una nueva', () => {
    // como en la app: primero lista vacía sin cargar, después llega la carga inicial
    const { rerender } = renderHook(({ ids, listo }) => useAvisoSonoro(ids, listo), {
      initialProps: { ids: [] as string[], listo: false },
    })
    rerender({ ids: ['a', 'b'], listo: true })
    expect(m.sonar).not.toHaveBeenCalled()
    rerender({ ids: ['a', 'b', 'c'], listo: true })
    expect(m.sonar).toHaveBeenCalledTimes(1)
    rerender({ ids: ['a', 'b', 'c'], listo: true })
    expect(m.sonar).toHaveBeenCalledTimes(1)
  })

  it('con el sonido apagado no suena', () => {
    m.activado = false
    const { rerender } = renderHook(({ ids }) => useAvisoSonoro(ids, true), { initialProps: { ids: [] as string[] } })
    rerender({ ids: ['x'] })
    expect(m.sonar).not.toHaveBeenCalled()
  })
})
