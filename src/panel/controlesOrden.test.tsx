import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControlHistorial } from '../domain/control'
import { ControlesOrden } from './ControlesOrden'

const m = vi.hoisted(() => ({ filas: [] as unknown[], cambios: { canales: [] as string[], avisar: () => {} } }))

vi.mock('../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('../lib/useRealtime', () => ({
  useCambios: (canales: string[], alCambiar: () => void) => {
    m.cambios.canales = canales
    m.cambios.avisar = alCambiar
  },
}))
vi.mock('./datosTanque', () => ({ cargarControles: () => Promise.resolve(m.filas) }))

const ctl = (over: Partial<ControlHistorial>): ControlHistorial => ({
  intento: 1,
  resultado: 'aprobado',
  ph: 7.2,
  densidad: 1.03,
  perfume_ok: true,
  perfume_comentario: null,
  visual_ok: true,
  visual_comentario: null,
  observaciones: null,
  firmado_nombre: 'Maria Gomez',
  origen: 'tablet',
  created_at: '2026-10-21T13:15:00Z',
  ...over,
})

const montar = async () => {
  await act(async () => {
    render(<ControlesOrden fabricacionId="f1" />)
  })
}

describe('ControlesOrden', () => {
  beforeEach(() => {
    m.filas = []
  })

  it('sin controles', async () => {
    await montar()
    expect(screen.getByText('Sin controles todavía.')).toBeInTheDocument()
  })

  it('lista cada intento con resultado, valores, firmante, hora y origen', async () => {
    m.filas = [
      ctl({ intento: 1, resultado: 'rechazado', perfume_ok: false, perfume_comentario: 'muy suave', observaciones: 'repetir' }),
      ctl({ intento: 2, densidad: null, origen: 'panel' }),
    ]
    await montar()
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText('Intento 1')).toBeInTheDocument()
    expect(within(items[0]).getByText('Rechazado')).toHaveClass('rechazado')
    expect(within(items[0]).getByText('Perfume No OK: muy suave')).toBeInTheDocument()
    expect(within(items[0]).getByText('Visual OK')).toBeInTheDocument()
    expect(within(items[0]).getByText(/pH 7,2/)).toBeInTheDocument()
    expect(within(items[0]).getByText(/Densidad 1,03/)).toBeInTheDocument()
    expect(within(items[0]).getByText('Observaciones: repetir')).toBeInTheDocument()
    expect(within(items[0]).getByText('Maria Gomez · 10:15 · tablet')).toBeInTheDocument()
    expect(within(items[1]).getByText('Aprobado')).toHaveClass('aprobado')
    expect(within(items[1]).queryByText(/Densidad/)).not.toBeInTheDocument()
    expect(within(items[1]).getByText('Maria Gomez · 10:15 · panel')).toBeInTheDocument()
  })

  it('se refresca con los cambios de controles', async () => {
    await montar()
    expect(m.cambios.canales).toEqual(['controles'])
    m.filas = [ctl({})]
    await act(async () => m.cambios.avisar())
    expect(screen.getByText('Intento 1')).toBeInTheDocument()
  })
})
