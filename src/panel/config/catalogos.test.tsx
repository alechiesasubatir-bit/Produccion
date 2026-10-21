import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Configuracion } from './Configuracion'

const m = vi.hoisted(() => ({
  filas: {} as Record<string, unknown[]>,
  insertar: vi.fn(),
  actualizar: vi.fn(),
}))

vi.mock('./datosCatalogo', () => ({
  listar: (tabla: string) => Promise.resolve(m.filas[tabla] ?? []),
  insertar: m.insertar,
  actualizar: m.actualizar,
}))
vi.mock('./Operarias', () => ({ Operarias: () => <p>operarias</p> }))
vi.mock('./Usuarios', () => ({ Usuarios: () => <p>usuarios</p> }))

async function montar(seccion?: string) {
  render(<Configuracion />)
  await act(async () => {})
  if (seccion) {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: seccion })))
    await act(async () => {})
  }
}

const cambiar = (etiqueta: string, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

describe('Configuración · productos', () => {
  beforeEach(() => {
    m.filas = { productos: [{ id: 'p1', nombre: 'Lavandina', color: '#0284c7', tipo: 'liquido', litros_hora_std: null, activo: true }] }
    m.insertar.mockReset()
  })

  it('color inválido no se guarda', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar' }))
    cambiar('Nombre', 'Cloro')
    cambiar('Color', '#12345')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(screen.getByText('Color inválido.')).toBeInTheDocument()
    expect(m.insertar).not.toHaveBeenCalled()
  })

  it('alta válida y vista previa con el color', async () => {
    m.insertar.mockResolvedValue({ error: null })
    await montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar' }))
    cambiar('Nombre', 'Cloro')
    cambiar('Color', '#16a34a')
    expect(document.querySelector('.vista-previa .ola')?.getAttribute('fill')).toBe('#16a34a')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(m.insertar).toHaveBeenCalledWith('productos', {
      nombre: 'Cloro',
      color: '#16a34a',
      tipo: 'liquido',
      litros_hora_std: null,
      activo: true,
    })
  })

  it('nombre repetido: mensaje humano', async () => {
    m.insertar.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint "productos_nombre_key"' } })
    await montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar' }))
    cambiar('Nombre', 'Lavandina')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Ya existe uno con ese nombre.')
  })
})

describe('Configuración · tanques', () => {
  it('desactivar un tanque', async () => {
    m.filas = { tanques: [{ id: 't1', codigo: 'T-01', capacidad_l: 2000, orden: 1, activo: true }] }
    m.actualizar.mockResolvedValue({ error: null })
    await montar('Tanques')
    const fila = screen.getByRole('row', { name: /T-01/ })
    await act(async () => fireEvent.click(within(fila).getByRole('button', { name: 'Desactivar' })))
    expect(m.actualizar).toHaveBeenCalledWith('tanques', 't1', { activo: false })
  })
})
