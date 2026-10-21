import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EstadoTanqueFila } from '../pages/ParedTanques'
import { Tanques } from './Tanques'

const tanque = (over: Partial<EstadoTanqueFila>): EstadoTanqueFila => ({
  tanque_id: 't1',
  codigo: 'T-01',
  capacidad_l: 2000,
  orden: 1,
  estado: 'libre',
  fabricacion_id: null,
  producto_id: null,
  producto: null,
  color: null,
  litros: null,
  litros_restantes: null,
  envasado_id: null,
  operaria_id: null,
  inicio: null,
  ...over,
})

const m = vi.hoisted(() => ({ tanques: [] as unknown[] }))

vi.mock('../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('../lib/acciones', () => ({ accionPanel: vi.fn() }))
vi.mock('./NuevaOrden', () => ({ NuevaOrden: () => null }))
vi.mock('./datosTanque', () => ({
  cargarRecorrido: () =>
    Promise.resolve([{ at: '2026-10-21T13:15:00Z', accion: 'iniciar', quien: 'Laura Paz', entidad: 'fabricacion' }]),
}))
vi.mock('../lib/useRealtime', () => ({
  useRealtime: () => ({ datos: m.tanques, conectado: true, enVivo: true, error: null, recargar: vi.fn() }),
}))

async function elegir(codigo: string) {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: new RegExp(`Tanque ${codigo}`) })))
  await act(async () => {})
  return screen.getByRole('complementary', { name: `Tanque ${codigo}` })
}

describe('Tanques', () => {
  it('al elegir un tanque abre el panel lateral con su QR', async () => {
    m.tanques = [tanque({})]
    render(<Tanques />)
    const aside = await elegir('T-01')
    expect(within(aside).getByRole('heading', { name: 'T-01' })).toBeInTheDocument()
    expect(aside.querySelector('.qr svg')).not.toBeNull()
    expect(within(aside).getByText(/\/planta\?tanque=T-01$/)).toBeInTheDocument()
  })

  it('tanque libre: ofrece nueva orden', async () => {
    m.tanques = [tanque({})]
    render(<Tanques />)
    const aside = await elegir('T-01')
    expect(within(aside).getByRole('button', { name: 'Nueva orden en este tanque' })).toBeInTheDocument()
  })

  it('recorrido con hora de Montevideo, acción y quién', async () => {
    m.tanques = [
      tanque({ estado: 'fabricando', fabricacion_id: 'fab1', producto: 'Lavandina', color: '#0284c7', litros: 1200 }),
    ]
    render(<Tanques />)
    const aside = await elegir('T-01')
    expect(within(aside).getByText('10:15 · inició · Laura Paz')).toBeInTheDocument()
    expect(within(aside).getByRole('button', { name: 'Pausar' })).toBeInTheDocument()
  })

  it('un "¿Seguro?" pendiente no pasa a otro tanque', async () => {
    m.tanques = [
      tanque({ estado: 'fabricando', fabricacion_id: 'fab1', producto: 'Lavandina', litros: 1200 }),
      tanque({ tanque_id: 't2', codigo: 'T-02', orden: 2, estado: 'fabricando', fabricacion_id: 'fab2', producto: 'Cloro', litros: 800 }),
    ]
    render(<Tanques />)
    const t1 = await elegir('T-01')
    fireEvent.click(within(t1).getByRole('button', { name: 'Cancelar' }))
    expect(within(t1).getByRole('button', { name: '¿Seguro?' })).toBeInTheDocument()
    const t2 = await elegir('T-02')
    expect(within(t2).queryByRole('button', { name: '¿Seguro?' })).toBeNull()
    expect(within(t2).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })
})
