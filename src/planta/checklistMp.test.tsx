import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import type { FilaMp } from '../lib/datosMp'
import { ChecklistMp } from './ChecklistMp'
import { MisTareas } from './MisTareas'

const m = vi.hoisted(() => ({ cargarMpDe: vi.fn(), guardarMp: vi.fn() }))
vi.mock('../lib/datosMp', () => ({ cargarMpDe: m.cargarMpDe }))
vi.mock('../lib/acciones', () => ({ guardarMp: m.guardarMp }))

function fila(orden: number, codigo: string, descripcion: string, cantidad: number, over: Partial<FilaMp> = {}): FilaMp {
  return {
    id: `mp${orden}`,
    orden,
    codigo,
    descripcion,
    cantidad,
    lote: null,
    pesado: false,
    cargado_por: null,
    cargado_at: null,
    ...over,
  }
}

const filas = () => [
  fila(1, '900101', 'Bacterias liofilizadas', 6.5),
  fila(2, '220012', 'Conservante', 0.4),
  fila(3, '220030', 'Tensioactivo', 18),
  fila(4, '100001', 'Agua desmineralizada', 967),
]

const props = { fabricacionId: 'F1', empleadoId: 'E1', habilitado: true }

beforeEach(() => {
  m.cargarMpDe.mockReset().mockResolvedValue(filas())
  m.guardarMp.mockReset().mockResolvedValue({ ok: true })
})

describe('ChecklistMp', () => {
  it('muestra las MP con lote y pesado, y el contador', async () => {
    render(<ChecklistMp {...props} onCambio={() => {}} />)
    expect(await screen.findByRole('textbox', { name: 'Lote de 900101' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Pesado 900101' })).not.toBeChecked()
    expect(screen.getByText('Bacterias liofilizadas')).toBeInTheDocument()
    expect(screen.getByText('0.4')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.getByText('0 de 4 MP')).toBeInTheDocument()
    expect(m.cargarMpDe).toHaveBeenCalledWith('F1')
  })

  it('guarda el lote al salir del campo y el pesado al tildar; con ambos la MP queda completa', async () => {
    const onCambio = vi.fn()
    render(<ChecklistMp {...props} onCambio={onCambio} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 900101' })
    fireEvent.change(lote, { target: { value: 'L-778' } })
    fireEvent.blur(lote)
    await waitFor(() =>
      expect(m.guardarMp).toHaveBeenCalledWith({ id: 'mp1', lote: 'L-778', pesado: false, empleadoId: 'E1' }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesado 900101' }))
    await waitFor(() =>
      expect(m.guardarMp).toHaveBeenLastCalledWith({ id: 'mp1', lote: 'L-778', pesado: true, empleadoId: 'E1' }),
    )
    expect(await screen.findByLabelText('900101 completa')).toBeInTheDocument()
    expect(screen.getByText('1 de 4 MP')).toBeInTheDocument()
    expect(onCambio).toHaveBeenLastCalledWith(1)
  })

  it('si guardar falla muestra el error en la fila y el valor queda escrito', async () => {
    m.guardarMp.mockResolvedValue({ ok: false, codigo: 'ESTADO_INVALIDO', texto: 'La fabricación ya no está en curso.' })
    render(<ChecklistMp {...props} onCambio={() => {}} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 900101' })
    fireEvent.change(lote, { target: { value: 'L-778' } })
    fireEvent.blur(lote)
    const fila1 = lote.closest('li') as HTMLElement
    expect(await within(fila1).findByRole('alert')).toHaveTextContent('La fabricación ya no está en curso.')
    expect(lote).toHaveValue('L-778')
    expect(screen.getByText('0 de 4 MP')).toBeInTheDocument()
  })

  it('error al guardar: el texto queda en la fila', async () => {
    m.guardarMp.mockResolvedValue({ ok: false, codigo: 'NO_AUTORIZADO', texto: 'No tenés permiso para esta acción.' })
    render(<ChecklistMp {...props} onCambio={() => {}} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Pesado 900101' }))
    expect(await screen.findByText('No tenés permiso para esta acción.')).toBeInTheDocument()
  })

  it('una respuesta que llega después de desmontar no avisa nada', async () => {
    let responder: (r: unknown) => void = () => {}
    m.guardarMp.mockReturnValue(new Promise((r) => (responder = r)))
    const onCambio = vi.fn()
    const { unmount } = render(<ChecklistMp {...props} onCambio={onCambio} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Pesado 900101' }))
    const llamadas = onCambio.mock.calls.length
    unmount()
    responder({ ok: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(onCambio).toHaveBeenCalledTimes(llamadas)
  })

  it('tipear el lote y tildar enseguida: los guardados de la fila van en orden, el último con lote y pesado', async () => {
    let responder: (r: unknown) => void = () => {}
    m.guardarMp.mockReturnValueOnce(new Promise((r) => (responder = r))).mockResolvedValue({ ok: true })
    render(<ChecklistMp {...props} onCambio={() => {}} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 900101' })
    fireEvent.change(lote, { target: { value: 'L-778' } })
    fireEvent.blur(lote)
    await new Promise((r) => setTimeout(r, 0)) // el primer guardado ya salió
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesado 900101' }))
    await new Promise((r) => setTimeout(r, 0))
    // el segundo no sale hasta que vuelve el primero
    expect(m.guardarMp).toHaveBeenCalledTimes(1)
    responder({ ok: true })
    await waitFor(() => expect(m.guardarMp).toHaveBeenCalledTimes(2))
    expect(m.guardarMp).toHaveBeenLastCalledWith({ id: 'mp1', lote: 'L-778', pesado: true, empleadoId: 'E1' })
    expect(await screen.findByLabelText('900101 completa')).toBeInTheDocument()
  })

  it('al cambiar "recarga" vuelve a leer las MP de la base', async () => {
    const { rerender } = render(<ChecklistMp {...props} recarga={0} onCambio={() => {}} />)
    await screen.findByRole('textbox', { name: 'Lote de 900101' })
    m.cargarMpDe.mockResolvedValue(filas().map((f) => (f.orden === 1 ? { ...f, lote: 'DB-1' } : f)))
    rerender(<ChecklistMp {...props} recarga={1} onCambio={() => {}} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Lote de 900101' })).toHaveValue('DB-1'))
    expect(m.cargarMpDe).toHaveBeenCalledTimes(2)
  })

  it('si no se pueden leer las MP lo avisa', async () => {
    m.cargarMpDe.mockRejectedValue(new Error('red'))
    render(<ChecklistMp {...props} onCambio={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar/)
  })
})

function tarea(over: Partial<Tarea> = {}): Tarea {
  return {
    entidad: 'fabricacion',
    id: 'F1',
    estado: 'fabricando',
    producto: 'Bactipro',
    color: '#0284c7',
    producto_tipo: null,
    operarias: [],
    etiqueta: null,
    control_intento: null,
    control_rechazo: null,
    vencimiento: null,
    tanque_codigo: 'T-01',
    presentacion: null,
    cantidad: null,
    litros: 1000,
    lote: '17702',
    descripcion: null,
    operaria_1: 'E1',
    operaria_2: null,
    listo: true,
    inicio: null,
    min_efectivos: 3,
    corriendo: true,
    created_at: '2026-10-21T10:00:00Z',
    mp_total: 4,
    mp_completas: 3,
    ...over,
  }
}

const base = {
  nombre: 'Laura Paz',
  empleadoId: 'E1',
  tanque: null,
  conectado: true,
  cargadoEn: Date.now(),
  aviso: null,
  onAccion: () => {},
  onSalir: () => {},
}

describe('autor de cada MP', () => {
  it('muestra quién marcó cada renglón, y otra operaria puede marcar', async () => {
    m.cargarMpDe.mockResolvedValue([fila(1, '900101', 'Bacterias', 6.5, { lote: 'L1', pesado: true, cargado_por: 'E2' }), fila(2, '220012', 'Conservante', 0.4)])
    render(<ChecklistMp {...props} nombres={{ E1: 'Laura', E2: 'Ana' }} onCambio={() => {}} />)
    expect(await screen.findByText('Marcó: Ana')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesado 220012' }))
    await waitFor(() => expect(m.guardarMp).toHaveBeenCalledWith({ id: 'mp2', lote: '', pesado: true, empleadoId: 'E1' }))
  })
})

describe('Tarjeta con MP en MisTareas', () => {
  it('con MP pendientes Finalizar está deshabilitado y dice cuántas faltan', async () => {
    m.cargarMpDe.mockReturnValue(new Promise(() => {}))
    render(<MisTareas {...base} tareas={[tarea()]} />)
    expect(screen.getByRole('button', { name: /Finalizar/ })).toBeDisabled()
    expect(screen.getByText('Faltan 1 MP por completar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled()
  })

  it('con todas las MP completas Finalizar está habilitado', () => {
    m.cargarMpDe.mockReturnValue(new Promise(() => {}))
    render(<MisTareas {...base} tareas={[tarea({ mp_completas: 4 })]} />)
    expect(screen.getByRole('button', { name: 'Finalizar' })).toBeEnabled()
    expect(screen.queryByText(/por completar/)).toBeNull()
  })

  it('el contador local manda: al completar la última MP se habilita Finalizar', async () => {
    m.cargarMpDe.mockResolvedValue(
      filas().map((f) => (f.orden === 4 ? f : { ...f, lote: 'X', pesado: true })),
    )
    render(<MisTareas {...base} tareas={[tarea()]} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 100001' })
    fireEvent.change(lote, { target: { value: 'A1' } })
    fireEvent.blur(lote)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesado 100001' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finalizar' })).toBeEnabled())
  })

  it('fabricación sin MP: sin checklist y Finalizar normal', () => {
    render(<MisTareas {...base} tareas={[tarea({ mp_total: 0, mp_completas: 0 })]} />)
    expect(screen.queryByRole('list', { name: /Materias primas/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Finalizar' })).toBeEnabled()
    expect(m.cargarMpDe).not.toHaveBeenCalled()
  })

  it('no muestra checklist en tareas disponibles para tomar', () => {
    render(<MisTareas {...base} tareas={[tarea({ estado: 'cola', operaria_1: null, corriendo: false })]} />)
    expect(m.cargarMpDe).not.toHaveBeenCalled()
  })
})
