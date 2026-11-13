import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import type { FilaConsumible } from '../lib/datosConsumibles'
import { ChecklistConsumibles } from './ChecklistConsumibles'
import { MisTareas } from './MisTareas'

const m = vi.hoisted(() => ({ cargarConsumiblesDe: vi.fn(), guardarConsumible: vi.fn() }))
vi.mock('../lib/datosConsumibles', () => ({ cargarConsumiblesDe: m.cargarConsumiblesDe }))
vi.mock('../lib/acciones', () => ({ guardarConsumible: m.guardarConsumible }))

function fila(orden: number, codigo: string, descripcion: string, over: Partial<FilaConsumible> = {}): FilaConsumible {
  return { id: `c${orden}`, orden, codigo, descripcion, cantidad: 100, lote: null, cargado_por: null, cargado_at: null, ...over }
}

const filas = () => [fila(1, '300001', 'Envase 1.5 L'), fila(2, '300002', 'Tapa')]
const props = { entidad: 'envasado' as const, entidadId: 'V1', empleadoId: 'E1', habilitado: true }

beforeEach(() => {
  m.cargarConsumiblesDe.mockReset().mockResolvedValue(filas())
  m.guardarConsumible.mockReset().mockResolvedValue({ ok: true })
})

describe('ChecklistConsumibles recarga', () => {
  it('al cambiar recarga actualiza el lote y el ✓ de otra fila', async () => {
    const { rerender } = render(<ChecklistConsumibles {...props} recarga={0} />)
    await screen.findByRole('textbox', { name: 'Lote de 300002' })
    m.cargarConsumiblesDe.mockResolvedValue([filas()[0], fila(2, '300002', 'Tapa', { lote: 'T-9', cargado_por: 'E2' })])
    rerender(<ChecklistConsumibles {...props} recarga={1} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Lote de 300002' })).toHaveValue('T-9'))
    expect(screen.getByLabelText('300002 con lote')).toBeInTheDocument()
  })

  it('una fila que se está editando conserva su borrador, las otras se actualizan', async () => {
    const { rerender } = render(<ChecklistConsumibles {...props} recarga={0} />)
    const lote1 = await screen.findByRole('textbox', { name: 'Lote de 300001' })
    fireEvent.focus(lote1)
    fireEvent.change(lote1, { target: { value: 'ESCRIBIENDO' } })
    m.cargarConsumiblesDe.mockResolvedValue([fila(1, '300001', 'Envase', { lote: 'OTRO' }), fila(2, '300002', 'Tapa', { lote: 'T-9' })])
    rerender(<ChecklistConsumibles {...props} recarga={1} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Lote de 300002' })).toHaveValue('T-9'))
    expect(screen.getByRole('textbox', { name: 'Lote de 300001' })).toHaveValue('ESCRIBIENDO')
  })
})

describe('ChecklistConsumibles recarga (correcciones)', () => {
  it('tras guardar, una recarga con otro lote de la base lo muestra', async () => {
    const { rerender } = render(<ChecklistConsumibles {...props} recarga={0} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 300001' })
    fireEvent.change(lote, { target: { value: 'X' } })
    fireEvent.blur(lote)
    await waitFor(() => expect(m.guardarConsumible).toHaveBeenCalledWith('c1', 'X', 'E1'))
    await screen.findByLabelText('300001 con lote')
    m.cargarConsumiblesDe.mockResolvedValue([fila(1, '300001', 'Envase', { lote: 'Y', cargado_por: 'E2' }), filas()[1]])
    rerender(<ChecklistConsumibles {...props} recarga={1} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Lote de 300001' })).toHaveValue('Y'))
  })

  it('si falla una recarga la lista sigue visible y sin error', async () => {
    const { rerender } = render(<ChecklistConsumibles {...props} recarga={0} />)
    await screen.findByRole('textbox', { name: 'Lote de 300001' })
    m.cargarConsumiblesDe.mockRejectedValue(new Error('red'))
    rerender(<ChecklistConsumibles {...props} recarga={1} />)
    await waitFor(() => expect(m.cargarConsumiblesDe).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Lote de 300001' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('ChecklistConsumibles', () => {
  it('guarda el lote con la operaria al salir del campo', async () => {
    render(<ChecklistConsumibles {...props} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 300001' })
    expect(m.cargarConsumiblesDe).toHaveBeenCalledWith('envasado', 'V1')
    fireEvent.change(lote, { target: { value: 'E-55' } })
    fireEvent.blur(lote)
    await waitFor(() => expect(m.guardarConsumible).toHaveBeenCalledWith('c1', 'E-55', 'E1'))
    expect(await screen.findByLabelText('300001 con lote')).toBeInTheDocument()
  })

  it('vaciar el lote lo borra', async () => {
    m.cargarConsumiblesDe.mockResolvedValue([fila(1, '300001', 'Envase', { lote: 'E-1' })])
    render(<ChecklistConsumibles {...props} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 300001' })
    fireEvent.change(lote, { target: { value: '' } })
    fireEvent.blur(lote)
    await waitFor(() => expect(m.guardarConsumible).toHaveBeenCalledWith('c1', '', 'E1'))
    await waitFor(() => expect(screen.queryByLabelText('300001 con lote')).toBeNull())
  })

  it('con lote muestra ✓ y quién lo cargó; sin lote no muestra error ni marca', async () => {
    m.cargarConsumiblesDe.mockResolvedValue([fila(1, '300001', 'Envase', { lote: 'E-1', cargado_por: 'E2' }), fila(2, '300002', 'Tapa')])
    render(<ChecklistConsumibles {...props} nombres={{ E2: 'Ana' }} />)
    expect(await screen.findByLabelText('300001 con lote')).toBeInTheDocument()
    expect(screen.queryByLabelText('300002 con lote')).toBeNull()
    expect(screen.getByText('Cargó: Ana')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('si falla el guardado muestra el error de esa fila', async () => {
    m.guardarConsumible.mockResolvedValue({ ok: false, codigo: 'X', texto: 'No se pudo' })
    render(<ChecklistConsumibles {...props} />)
    const lote = await screen.findByRole('textbox', { name: 'Lote de 300001' })
    fireEvent.change(lote, { target: { value: 'Z' } })
    fireEvent.blur(lote)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo')
  })
})

function tarea(over: Partial<Tarea> = {}): Tarea {
  return {
    entidad: 'envasado',
    id: 'V1',
    estado: 'activo',
    producto: 'Limpiador Prueba',
    color: '#0284c7',
    producto_tipo: null,
    operarias: [],
    etiqueta: null,
    control_intento: null,
    control_rechazo: null,
    lote_doc: 'LD-9',
    consumibles_total: 2,
    consumibles_con_lote: 0,
    vencimiento: null,
    tanque_codigo: null,
    presentacion: '1.5 L',
    cantidad: 630,
    litros: null,
    lote: null,
    descripcion: 'Limpiador Prueba x 1.5 L',
    operaria_1: 'E1',
    operaria_2: null,
    listo: true,
    inicio: null,
    min_efectivos: 3,
    corriendo: true,
    created_at: '2026-10-21T10:00:00Z',
    mp_total: 0,
    mp_completas: 0,
    ...over,
  } as Tarea
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

describe('Consumibles en MisTareas', () => {
  it('muestra el checklist, el título con la descripción y el lote del documento; Finalizar queda habilitado', async () => {
    render(<MisTareas {...base} tareas={[tarea()]} />)
    expect(await screen.findByRole('textbox', { name: 'Lote de 300001' })).toBeInTheDocument()
    expect(screen.getAllByText('Limpiador Prueba x 1.5 L · 630').length).toBeGreaterThan(0)
    expect(screen.getByText('Lote doc. LD-9')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar' })).toBeEnabled()
  })

  it('sin consumibles no hay checklist', () => {
    render(<MisTareas {...base} tareas={[tarea({ consumibles_total: 0 })]} />)
    expect(m.cargarConsumiblesDe).not.toHaveBeenCalled()
  })

  it('en cola (no activa ni pausada) no hay checklist', () => {
    render(<MisTareas {...base} tareas={[tarea({ estado: 'cola' })]} />)
    expect(m.cargarConsumiblesDe).not.toHaveBeenCalled()
  })
})
