import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DatosOrden } from './datosOrden'
import { NuevaOrden } from './NuevaOrden'

const m = vi.hoisted(() => ({ escanear: vi.fn() }))

const datos: DatosOrden = {
  tanques: [{ tanque_id: 't1', codigo: 'T-01', capacidad_l: 5000, estado: 'libre', fabricacion_id: null, producto: null, litros_restantes: null }],
  productos: [{ id: 'p1', nombre: 'Lavandina', color: '#0284c7' }],
  presentaciones: [{ id: 'pr1', nombre: '5L', litros_equiv: 5 }],
  operarias: [],
  asignados: {},
  estandares: [],
}

vi.mock('./datosOrden', () => ({
  cargarDatosOrden: () => Promise.resolve(datos),
  crearOrden: vi.fn(),
  escanearHoja: m.escanear,
}))
vi.mock('./imagen', () => ({ reducirImagen: () => Promise.resolve('BASE64') }))

async function escanear() {
  render(<NuevaOrden abierta onCerrar={() => {}} onCreada={() => {}} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Escanear hoja' }))
  const archivo = new File(['x'], 'hoja.jpg', { type: 'image/jpeg' })
  await act(async () => fireEvent.change(screen.getByLabelText('Foto de la hoja'), { target: { files: [archivo] } }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Analizar' })))
}

describe('Escanear hoja', () => {
  it('si falla, muestra el error y el formulario queda editable', async () => {
    m.escanear.mockResolvedValue({ ok: false, error: 'El servicio de lectura no respondió.' })
    await escanear()
    expect(screen.getByRole('alert')).toHaveTextContent('El servicio de lectura no respondió.')
    expect(screen.getByLabelText('Litros')).toBeEnabled()
  })

  it('si sale bien, precarga los campos y muestra los avisos', async () => {
    m.escanear.mockResolvedValue({
      ok: true,
      datos: { producto: 'LAVANDINA', cantidad: '3,000.000', lote: 'L-55', fecha: '21/10/2026' },
    })
    await escanear()
    expect(m.escanear).toHaveBeenCalledWith('fabricacion', 'BASE64')
    expect(screen.getByLabelText('Producto')).toHaveValue('p1')
    expect(screen.getByLabelText('Litros')).toHaveValue(3000)
    expect(screen.getByLabelText('Lote')).toHaveValue('L-55')
  })
})
