import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DatosOrden } from './datosOrden'
import { NuevaOrden } from './NuevaOrden'

const m = vi.hoisted(() => ({ crearOrden: vi.fn() }))

const datos: DatosOrden = {
  tanques: [
    { tanque_id: 't1', codigo: 'T-01', capacidad_l: 2000, estado: 'libre', fabricacion_id: null, producto: null, litros_restantes: null },
    { tanque_id: 't2', codigo: 'T-02', capacidad_l: 2000, estado: 'fabricando', fabricacion_id: 'fab2', producto: 'Cloro', litros_restantes: 1000 },
    { tanque_id: 't3', codigo: 'T-03', capacidad_l: 2000, estado: 'para_envasar', fabricacion_id: 'fab3', producto: 'Lavandina', litros_restantes: 300 },
  ],
  productos: [{ id: 'p1', nombre: 'Lavandina', color: '#0284c7' }],
  presentaciones: [{ id: 'pr1', nombre: '5L', litros_equiv: 5 }],
  operarias: [{ empleado_id: 'E1', nombre: 'Laura Paz' }],
}

vi.mock('./datosOrden', () => ({
  cargarDatosOrden: () => Promise.resolve(datos),
  crearOrden: m.crearOrden,
}))

async function abrir(props: Partial<Parameters<typeof NuevaOrden>[0]> = {}) {
  const onCreada = vi.fn()
  render(<NuevaOrden abierta onCerrar={() => {}} onCreada={onCreada} {...props} />)
  await act(async () => {})
  return { onCreada }
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta)
const cambiar = (etiqueta: string, valor: string) => fireEvent.change(campo(etiqueta), { target: { value: valor } })

describe('NuevaOrden · fabricación', () => {
  it('no deja pasar la capacidad del tanque', async () => {
    await abrir()
    cambiar('Tanque', 't1')
    cambiar('Producto', 'p1')
    cambiar('Litros', '2500')
    expect(screen.getByText('Máximo 2000 L.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear orden' })).toBeDisabled()
  })

  it('solo ofrece tanques libres', async () => {
    await abrir()
    const opciones = within(campo('Tanque')).getAllByRole('option').map((o) => o.textContent)
    expect(opciones.some((t) => t?.includes('T-01'))).toBe(true)
    expect(opciones.some((t) => t?.includes('T-02') || t?.includes('T-03'))).toBe(false)
  })

  it('tanque ocupado por otra orden: mensaje humano', async () => {
    m.crearOrden.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint "fabricaciones_tanque_abierta_uk"' },
    })
    await abrir()
    cambiar('Tanque', 't1')
    cambiar('Producto', 'p1')
    cambiar('Litros', '1200')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear orden' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Ese tanque ya tiene una orden abierta.')
  })

  it('crea la orden con los datos del formulario', async () => {
    m.crearOrden.mockResolvedValue({ error: null })
    const { onCreada } = await abrir()
    cambiar('Tanque', 't1')
    cambiar('Producto', 'p1')
    cambiar('Litros', '1200')
    cambiar('Lote', 'L-1')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear orden' })))
    expect(m.crearOrden).toHaveBeenLastCalledWith('fabricacion', {
      tanque_id: 't1',
      producto_id: 'p1',
      litros: 1200,
      lote: 'L-1',
      operaria_id: null,
    })
    expect(onCreada).toHaveBeenCalled()
  })
})

describe('NuevaOrden · envasado', () => {
  it('avisa si usa más de lo que queda pero deja crear', async () => {
    await abrir({ tipoInicial: 'envasado' })
    cambiar('Tanque a envasar', 'fab3')
    cambiar('Presentación', 'pr1')
    cambiar('Cantidad', '100')
    expect(screen.getByRole('status')).toHaveTextContent('Quedan 300 L en el tanque y esta orden usa 500 L.')
    expect(screen.getByRole('button', { name: 'Crear orden' })).toBeEnabled()
  })
})
