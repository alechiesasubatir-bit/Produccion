import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Operarias } from './Operarias'
import { Usuarios } from './Usuarios'

const m = vi.hoisted(() => ({
  altaOperaria: vi.fn(),
  cambiarPin: vi.fn(),
  cambiarActiva: vi.fn(),
  setRol: vi.fn(),
}))

vi.mock('./datosPersonas', () => ({
  listarFuncionarios: () =>
    Promise.resolve([
      { id: 'F1', nombre: 'Laura Paz', foto_url: null, sector: 'Producción', estado: 'activo' },
      { id: 'F2', nombre: 'Rosa Díaz', foto_url: null, sector: 'Producción', estado: 'activo' },
      { id: 'F3', nombre: 'Juan Logística', foto_url: null, sector: 'Logística', estado: 'activo' },
    ]),
  listarOperarias: () => Promise.resolve([{ empleado_id: 'F1', categoria: 'A', color_avatar: '#0284c7', activo: true }]),
  altaOperaria: m.altaOperaria,
  cambiarPin: m.cambiarPin,
  cambiarActiva: m.cambiarActiva,
  listarUsuarios: () =>
    Promise.resolve([
      { id: 'U1', email: 'enc@x.uy', nombre: 'Encargada', rol: 'sin_acceso', rol_produccion: 'panel', activo: true },
      { id: 'U2', email: 'tablet@x.uy', nombre: 'Tablet', rol: 'sin_acceso', rol_produccion: null, activo: true },
      { id: 'U3', email: 'admin@x.uy', nombre: 'Admin', rol: 'admin', rol_produccion: null, activo: true },
    ]),
  setRol: m.setRol,
}))
vi.mock('../../auth/useSesion', () => ({ useSesion: () => ({ usuario: { id: 'U1' } }) }))

async function montar(c: React.ReactElement) {
  render(c)
  await act(async () => {})
}

const cambiar = (etiqueta: string, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

async function elegirRosa() {
  await montar(<Operarias />)
  fireEvent.click(screen.getByRole('button', { name: '+ Agregar operaria' }))
  fireEvent.click(screen.getByRole('button', { name: /Rosa Díaz/ }))
  cambiar('Categoría', 'A')
  cambiar('Color', '#db2777')
}

describe('Operarias', () => {
  beforeEach(() => m.altaOperaria.mockReset())

  it('el buscador no ofrece a quien ya es operaria ni a otros sectores', async () => {
    await montar(<Operarias />)
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar operaria' }))
    const candidatas = screen.getByRole('list', { name: 'Personas disponibles' })
    expect(within(candidatas).queryByRole('button', { name: /Laura Paz/ })).toBeNull()
    expect(within(candidatas).queryByRole('button', { name: /Juan Logística/ })).toBeNull()
    expect(within(candidatas).getByRole('button', { name: /Rosa Díaz/ })).toBeInTheDocument()
  })

  it('PIN inválido no llama a la API', async () => {
    await elegirRosa()
    cambiar('PIN inicial', '12a4')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dar de alta' })))
    expect(screen.getByText('El PIN son 4 dígitos.')).toBeInTheDocument()
    expect(m.altaOperaria).not.toHaveBeenCalled()
  })

  it('alta válida', async () => {
    m.altaOperaria.mockResolvedValue({ error: null })
    await elegirRosa()
    cambiar('PIN inicial', '1234')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dar de alta' })))
    expect(m.altaOperaria).toHaveBeenCalledWith({ empleado_id: 'F2', categoria: 'A', color_avatar: '#db2777' }, '1234')
  })

  it('si ya era operaria: mensaje humano', async () => {
    m.altaOperaria.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint "operarias_pkey"' },
    })
    await elegirRosa()
    cambiar('PIN inicial', '1234')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dar de alta' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Esa persona ya es operaria.')
  })
})

describe('Usuarios', () => {
  it('asigna rol de planta', async () => {
    m.setRol.mockResolvedValue({ error: null })
    await montar(<Usuarios />)
    await act(async () => cambiar('Rol de tablet@x.uy', 'planta'))
    expect(m.setRol).toHaveBeenCalledWith('U2', 'planta')
  })

  it('no se puede cambiar el propio rol y los admin son panel fijo', async () => {
    await montar(<Usuarios />)
    expect(screen.getByLabelText('Rol de enc@x.uy')).toBeDisabled()
    expect(screen.getByText('(vos)')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /admin@x.uy/ })).getByText('Panel (admin)')).toBeInTheDocument()
  })
})
