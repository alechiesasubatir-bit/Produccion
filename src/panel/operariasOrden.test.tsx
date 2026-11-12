import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParticipacionFila } from './datosTanque'
import { OperariasOrden } from './OperariasOrden'

const m = vi.hoisted(() => ({
  filas: [] as unknown[],
  legacy: [] as string[],
  mp: new Map<string, number>(),
  corregir: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('../lib/acciones', () => ({ corregirCantidad: m.corregir }))
vi.mock('./datosTanque', () => ({
  cargarParticipaciones: () => Promise.resolve(m.filas),
  cargarOperariasLegacy: () => Promise.resolve(m.legacy),
  cargarMpPorOperaria: () => Promise.resolve(m.mp),
  cargarEsperadoEnvasado: () => Promise.resolve(null),
}))

const part = (over: Partial<ParticipacionFila>): ParticipacionFila => ({
  id: 'p1',
  empleado_id: 'E1',
  nombre: 'Laura Paz',
  desde: '2026-10-21T13:15:00Z',
  hasta: '2026-10-21T14:00:00Z',
  cantidad: 100,
  unidad: 'L',
  cantidad_corregida: null,
  corregida_at: null,
  corregida_por_nombre: null,
  ...over,
})

const montar = async (props: Partial<Parameters<typeof OperariasOrden>[0]> = {}) => {
  await act(async () => {
    render(<OperariasOrden entidad="envasado" id="e1" {...props} />)
  })
}

describe('OperariasOrden', () => {
  beforeEach(() => {
    m.filas = []
    m.legacy = []
    m.mp = new Map()
    m.corregir.mockReset().mockResolvedValue({ ok: true })
  })

  it('tabla con horas de Montevideo y «sigue» para las abiertas', async () => {
    m.filas = [part({}), part({ id: 'p2', empleado_id: 'E2', nombre: 'Juana', hasta: null, cantidad: null })]
    await montar()
    for (const c of ['Operaria', 'Desde', 'Hasta', 'Declaró', 'Corregido']) expect(screen.getByText(c)).toBeTruthy()
    expect(screen.getAllByText('10:15')).toHaveLength(2)
    expect(screen.getByText('sigue')).toBeTruthy()
  })

  it('Corregir abre el campo, guarda y recarga', async () => {
    m.filas = [part({ cantidad: 120 })]
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Corregir' }))
    const guardar = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    expect(guardar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Cantidad de Laura Paz'), { target: { value: '115,5' } })
    expect(guardar.disabled).toBe(false)
    await act(async () => fireEvent.click(guardar))
    expect(m.corregir).toHaveBeenCalledWith({ participacionId: 'p1', cantidad: 115.5, unidad: 'L' })
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
  })

  it('muestra el original tachado y quién corrigió', async () => {
    m.filas = [part({ cantidad: 120, cantidad_corregida: 115, corregida_por_nombre: 'Juana', corregida_at: '2026-10-21T14:02:00Z' })]
    await montar()
    expect(screen.getByText('120 L').tagName).toBe('S')
    expect(screen.getByText('115 L · corregido por Juana 11:02')).toBeTruthy()
  })

  it('cerrada sin cantidad: «Falta declarar» y «Cargar»', async () => {
    m.filas = [part({ cantidad: null, unidad: null })]
    await montar()
    expect(screen.getByText('Falta declarar')).toBeTruthy()
    expect(screen.getByText(/Faltan declarar: 1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar' }))
    fireEvent.change(screen.getByLabelText('Cantidad de Laura Paz'), { target: { value: '30' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(m.corregir).toHaveBeenCalledWith({ participacionId: 'p1', cantidad: 30, unidad: 'L' })
  })

  it('total igual al esperado sin ámbar; distinto, con ámbar', async () => {
    m.filas = [part({ cantidad: 100 })]
    const { unmount } = render(<OperariasOrden entidad="envasado" id="e1" cantidad={100} presentacionLitros={1} />)
    await act(async () => {})
    const total = screen.getByText(/Total declarado: 100 L/).closest('p')!
    expect(total.textContent).toContain('Esperado: 100 L')
    expect(total.className).not.toContain('aviso')
    unmount()
    m.filas = [part({ cantidad: 90 })]
    render(<OperariasOrden entidad="envasado" id="e1" cantidad={100} presentacionLitros={1} />)
    await act(async () => {})
    expect(screen.getByText(/Total declarado: 90 L/).closest('p')!.className).toContain('aviso')
  })

  it('con el total declarado en kg no marca desvío contra el esperado en L', async () => {
    m.filas = [part({ cantidad: 90, unidad: 'kg' })]
    render(<OperariasOrden entidad="envasado" id="e1" cantidad={100} presentacionLitros={1} />)
    await act(async () => {})
    expect(screen.getByText(/Total declarado: 90 kg/).closest('p')!.className).not.toContain('aviso')
  })

  it('fabricación: columna «MP cargadas»', async () => {
    m.filas = [part({ cantidad: null })]
    m.mp = new Map([['E1', 4]])
    await montar({ entidad: 'fabricacion', id: 'f1' })
    expect(screen.getByText('MP cargadas')).toBeTruthy()
    expect(screen.queryByText('Declaró')).toBeNull()
    expect(within(screen.getByRole('row', { name: /Laura Paz/ })).getByText('4')).toBeTruthy()
    expect(screen.queryByText('Falta declarar')).toBeNull()
  })

  it('orden vieja sin participaciones: nombres de la orden, sin faltantes ni totales', async () => {
    m.legacy = ['Laura Paz', 'Juana']
    await montar()
    expect(screen.getByText('Laura Paz · Juana')).toBeTruthy()
    expect(screen.queryByText(/Falta declarar|Total declarado/)).toBeNull()
  })
})
