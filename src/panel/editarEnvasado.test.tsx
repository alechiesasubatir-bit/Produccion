import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilaFlujo } from '../domain/flujo'
import type { DatosOrden, EnvasadoEditable } from './datosOrden'
import { EditarEnvasado } from './EditarEnvasado'
import { EsperandoFabricacion } from './EsperandoFabricacion'

const m = vi.hoisted(() => ({ editar: vi.fn(), env: null as unknown, accion: vi.fn() }))

vi.mock('../lib/acciones', () => ({ accionPanel: m.accion }))

const datos = {
  tanques: [
    { tanque_id: 't1', codigo: 'T-01', capacidad_l: 2000, estado: 'fabricando', fabricacion_id: 'fab1', producto: 'Lavandina', litros_restantes: 1000 },
    { tanque_id: 't2', codigo: 'T-02', capacidad_l: 2000, estado: 'fabricando', fabricacion_id: 'fab2', producto: 'Lavandina', litros_restantes: 1000 },
    { tanque_id: 't3', codigo: 'T-03', capacidad_l: 2000, estado: 'fabricando', fabricacion_id: 'fab3', producto: 'Cloro', litros_restantes: 1000 },
  ],
  presentaciones: [
    { id: 'pr1', nombre: '5L', litros_equiv: 5 },
    { id: 'pr2', nombre: '1L', litros_equiv: 1 },
  ],
  fabricacionesAbiertas: [
    { id: 'fab1', producto_id: 'p1', tanque_id: 't1', lote: 'L1', litros: 1000, sinAsignar: 800 },
    { id: 'fab2', producto_id: 'p1', tanque_id: 't2', lote: null, litros: 500, sinAsignar: 500 },
    { id: 'fab3', producto_id: 'p2', tanque_id: 't3', lote: null, litros: 500, sinAsignar: 500 },
  ],
} as unknown as DatosOrden

vi.mock('./datosOrden', () => ({
  cargarDatosOrden: () => Promise.resolve(datos),
  cargarEnvasadoEdicion: () => Promise.resolve(m.env),
  editarEnvasado: m.editar,
}))

const env = (over: Partial<EnvasadoEditable> = {}): EnvasadoEditable => ({
  cantidad: 10,
  presentacion_id: 'pr1',
  estado: 'cola',
  fabricacion_id: 'fab1',
  granel_id: null,
  ...over,
})

async function abrir(props: Partial<Parameters<typeof EditarEnvasado>[0]> = {}) {
  const onGuardado = vi.fn()
  const onCerrar = vi.fn()
  render(<EditarEnvasado id="e1" onCerrar={onCerrar} onGuardado={onGuardado} {...props} />)
  await act(async () => {})
  return { onGuardado, onCerrar }
}

beforeEach(() => {
  m.editar.mockReset()
  m.editar.mockResolvedValue({ ok: true })
  m.env = env()
})

describe('EditarEnvasado', () => {
  it('editar la cantidad manda solo {cantidad}', async () => {
    const { onGuardado } = await abrir()
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '12' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(m.editar).toHaveBeenCalledWith('e1', { cantidad: 12 })
    expect(onGuardado).toHaveBeenCalled()
  })

  it('el tanque solo ofrece fabricaciones del mismo granel', async () => {
    await abrir()
    const opciones = Array.from((screen.getByLabelText('Tanque') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(opciones.join('|')).toContain('T-02')
    expect(opciones.join('|')).not.toContain('T-03')
  })

  it('el tanque está deshabilitado si el envasado está activo', async () => {
    m.env = env({ estado: 'activo' })
    await abrir()
    expect(screen.getByLabelText('Tanque')).toBeDisabled()
  })

  it('el tanque se puede cambiar en cola', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Tanque'), { target: { value: 'fab2' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(m.editar).toHaveBeenCalledWith('e1', { fabricacion_id: 'fab2' })
  })

  it('muestra el error de la base en el diálogo y no cierra', async () => {
    m.editar.mockResolvedValue({ ok: false, texto: 'El tanque ya está en uso.' })
    const { onGuardado } = await abrir()
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '12' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(screen.getByRole('alert')).toHaveTextContent('El tanque ya está en uso.')
    expect(onGuardado).not.toHaveBeenCalled()
  })
})

let n = 0
const esperando = (over: Partial<FilaFlujo> = {}) => {
  n += 1
  return {
    entidad: 'envasado',
    id: `w${n}`,
    estado: 'cola',
    producto: 'Lavandina',
    descripcion: 'Lavandina 5L',
    presentacion: '5L',
    cantidad: 10,
    lote_doc: 'D1',
    lote: null,
    fabricacion_id: null,
    granel_id: 'p1',
    ...over,
  } as unknown as FilaFlujo
}

describe('EsperandoFabricacion', () => {
  it('no aparece sin envasados esperando', () => {
    render(<EsperandoFabricacion filas={[esperando({ fabricacion_id: 'fab1' })]} habilitado onCambio={() => {}} />)
    expect(screen.queryByText('Esperando fabricación')).toBeNull()
  })

  it('agrupa por granel y muestra producto, cantidad y lote', () => {
    render(
      <EsperandoFabricacion
        filas={[esperando(), esperando({ descripcion: 'Lavandina 1L', presentacion: '1L' }), esperando({ producto: 'Cloro', descripcion: 'Cloro 1L' })]}
        habilitado
        onCambio={() => {}}
      />,
    )
    expect(screen.getByRole('region', { name: 'Esperando fabricación' })).toBeInTheDocument()
    expect(screen.getAllByRole('group')).toHaveLength(2)
    expect(screen.getByText('Lavandina 1L')).toBeInTheDocument()
    expect(screen.getAllByText('Lote D1').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Asignar tanque' })).toHaveLength(3)
  })

  it('asignar tanque manda {fabricacion_id}', async () => {
    m.env = env({ fabricacion_id: null, granel_id: 'p1' })
    const onCambio = vi.fn()
    render(<EsperandoFabricacion filas={[esperando()]} habilitado onCambio={onCambio} />)
    fireEvent.click(screen.getByRole('button', { name: 'Asignar tanque' }))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('Tanque'), { target: { value: 'fab2' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(m.editar).toHaveBeenCalledWith('w' + n, { fabricacion_id: 'fab2' })
    expect(onCambio).toHaveBeenCalled()
  })

  it('cancelar pide confirmación y manda la acción cancelar', async () => {
    m.accion.mockReset().mockResolvedValue({ ok: true, fabricacionCerrada: false })
    const onCambio = vi.fn()
    render(<EsperandoFabricacion filas={[esperando()]} habilitado onCambio={onCambio} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(m.accion).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '¿Seguro?' })))
    expect(m.accion).toHaveBeenCalledWith({ entidad: 'envasado', id: 'w' + n, accion: 'cancelar' })
    expect(onCambio).toHaveBeenCalled()
  })

  it('si cancelar falla muestra el motivo', async () => {
    m.accion.mockReset().mockResolvedValue({ ok: false, codigo: 'TRANSICION_INVALIDA', texto: 'Ya no se puede cancelar.' })
    render(<EsperandoFabricacion filas={[esperando()]} habilitado onCambio={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '¿Seguro?' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Ya no se puede cancelar.')
  })

  it('editar abre el diálogo completo (cantidad y presentación) y guarda', async () => {
    m.env = env({ fabricacion_id: null, granel_id: 'p1' })
    m.editar.mockClear()
    const onCambio = vi.fn()
    render(<EsperandoFabricacion filas={[esperando()]} habilitado onCambio={onCambio} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '7' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(m.editar).toHaveBeenCalledWith('w' + n, { cantidad: 7 })
    expect(onCambio).toHaveBeenCalled()
  })
})
