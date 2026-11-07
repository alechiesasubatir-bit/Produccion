import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilaMp } from '../lib/datosMp'
import { TablaMp } from './TablaMp'

const m = vi.hoisted(() => ({
  cargarMp: vi.fn(),
  guardarMp: vi.fn(),
  operarias: [] as { empleado_id: string; nombre: string }[],
}))

vi.mock('../lib/datosMp', () => ({ cargarMpDe: m.cargarMp }))
vi.mock('../lib/acciones', () => ({ guardarMp: m.guardarMp }))
vi.mock('../lib/supabase', () => ({
  db: { from: () => ({ select: () => Promise.resolve({ data: m.operarias, error: null }) }) },
}))

const filaMp = (over: Partial<FilaMp> = {}): FilaMp => ({
  id: 'mp1',
  orden: 1,
  codigo: '900101',
  descripcion: 'Esencia Floral Prueba',
  cantidad: 6.5,
  lote: 'L-55',
  pesado: true,
  cargado_por: 'E1',
  cargado_at: '2026-10-21T13:15:00Z',
  ...over,
})

async function montar(fabricacionId = 'f1', estado?: string, plegable = false) {
  render(<TablaMp fabricacionId={fabricacionId} estado={estado} plegable={plegable} />)
  await act(async () => {})
}

beforeEach(() => {
  m.guardarMp.mockReset().mockResolvedValue({ ok: true })
})

describe('TablaMp', () => {
  it('muestra las filas con código, lote, pesado, quién cargó y la hora', async () => {
    m.operarias = [{ empleado_id: 'E1', nombre: 'Laura Paz' }]
    m.cargarMp.mockResolvedValue([
      filaMp({ id: 'mp1' }),
      filaMp({ id: 'mp2', codigo: '220066', lote: null, pesado: false, cargado_por: null, cargado_at: null }),
    ])
    await montar()

    const filas = screen.getAllByRole('row')
    const fila1 = within(filas[1])
    expect(fila1.getByText('L-55')).toBeInTheDocument()
    expect(fila1.getByText('✓')).toBeInTheDocument()
    expect(fila1.getByText('Laura Paz')).toBeInTheDocument()
    expect(fila1.getByText('10:15')).toBeInTheDocument()

    const fila2 = within(filas[2])
    expect(fila2.getByText('—', { selector: 'td:nth-child(4)' })).toBeInTheDocument()
  })

  it('sin materias primas muestra el aviso de orden cargada a mano', async () => {
    m.cargarMp.mockResolvedValue([])
    await montar()
    expect(screen.getByText('Sin materias primas (orden cargada a mano)')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('si falla la carga muestra un aviso', async () => {
    m.cargarMp.mockRejectedValue(new Error('boom'))
    await montar()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('finalizada (o historial): solo lectura, sin campos para editar', async () => {
    m.cargarMp.mockResolvedValue([filaMp()])
    await montar('f1', 'para_envasar')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

describe('TablaMp editable (fabricación en curso sin operaria en la tablet)', () => {
  const pendiente = () => filaMp({ lote: null, pesado: false, cargado_por: null, cargado_at: null })

  it('fabricando: guarda el lote al salir del campo y el pesado al tildar, sin operaria ni PIN', async () => {
    m.cargarMp.mockResolvedValue([pendiente()])
    await montar('f1', 'fabricando')
    const lote = screen.getByRole('textbox', { name: 'Lote de 900101' })
    fireEvent.change(lote, { target: { value: 'L-778' } })
    fireEvent.blur(lote)
    await waitFor(() => expect(m.guardarMp).toHaveBeenCalledWith({ id: 'mp1', lote: 'L-778', pesado: false }))
    expect(await screen.findByText('Guardado')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesado 900101' }))
    await waitFor(() => expect(m.guardarMp).toHaveBeenLastCalledWith({ id: 'mp1', lote: 'L-778', pesado: true }))
    expect(screen.getByRole('checkbox', { name: 'Pesado 900101' })).toBeChecked()
  })

  it('pausada también se puede editar', async () => {
    m.cargarMp.mockResolvedValue([pendiente()])
    await montar('f1', 'pausada')
    expect(screen.getByRole('textbox', { name: 'Lote de 900101' })).toBeEnabled()
  })

  it('si guardar falla muestra el error en la fila', async () => {
    m.cargarMp.mockResolvedValue([pendiente()])
    m.guardarMp.mockResolvedValue({ ok: false, codigo: 'TRANSICION_INVALIDA', texto: 'Ya no está en curso.' })
    await montar('f1', 'fabricando')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesado 900101' }))
    const fila = screen.getByRole('checkbox', { name: 'Pesado 900101' }).closest('tr') as HTMLElement
    expect(await within(fila).findByRole('alert')).toHaveTextContent('Ya no está en curso.')
  })

  it('lote y pesado seguidos: el segundo guardado espera al primero y manda ambos', async () => {
    let responder: (r: unknown) => void = () => {}
    m.cargarMp.mockResolvedValue([pendiente()])
    m.guardarMp.mockReturnValueOnce(new Promise((r) => (responder = r))).mockResolvedValue({ ok: true })
    await montar('f1', 'fabricando')
    const lote = screen.getByRole('textbox', { name: 'Lote de 900101' })
    fireEvent.change(lote, { target: { value: 'L-9' } })
    fireEvent.blur(lote)
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesado 900101' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(m.guardarMp).toHaveBeenCalledTimes(1)
    await act(async () => responder({ ok: true }))
    await waitFor(() => expect(m.guardarMp).toHaveBeenCalledTimes(2))
    expect(m.guardarMp).toHaveBeenLastCalledWith({ id: 'mp1', lote: 'L-9', pesado: true })
  })
})

describe('TablaMp plegable (detalle de tanque)', () => {
  const completa = filaMp()
  const pendiente = filaMp({ id: 'mp2', codigo: '220066', lote: null, pesado: false, cargado_por: null, cargado_at: null })

  it('por defecto plegada: «Ver MP (N)» y al tocar muestra la tabla y «Ocultar MP»', async () => {
    m.cargarMp.mockResolvedValue([completa, pendiente])
    await montar('f1', 'para_envasar', true)
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver MP (2)' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar MP' }))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('en curso y con MP incompletas arranca desplegada (hay que cargarlas)', async () => {
    m.cargarMp.mockResolvedValue([completa, pendiente])
    await montar('f1', 'fabricando', true)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ocultar MP' })).toBeInTheDocument()
  })

  it('en curso pero con todas las MP completas arranca plegada', async () => {
    m.cargarMp.mockResolvedValue([completa])
    await montar('f1', 'pausada', true)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ver MP (1)' })).toBeInTheDocument()
  })

  it('sin MP no ocupa lugar: ni sección ni botón', async () => {
    m.cargarMp.mockResolvedValue([])
    await montar('f1', 'fabricando', true)
    expect(screen.queryByRole('region', { name: 'Materias primas' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/Sin m/i)).toBeNull()
  })

  it('con MP es su propia sección «Materias primas»', async () => {
    m.cargarMp.mockResolvedValue([completa])
    await montar('f1', 'para_envasar', true)
    expect(screen.getByRole('region', { name: 'Materias primas' })).toContainElement(screen.getByRole('button', { name: 'Ver MP (1)' }))
  })
})
