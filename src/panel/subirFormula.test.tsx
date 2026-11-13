import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import bactipro from '../domain/__fixtures__/bactipro.json'
import type { Fragmento } from '../domain/formulaPdf'
import type { DatosOrden } from './datosOrden'
import { SubirFormula } from './SubirFormula'

const m = vi.hoisted(() => ({ extraer: vi.fn(), crear: vi.fn() }))

vi.mock('./leerPdf', () => ({ extraerFragmentos: m.extraer }))
vi.mock('./datosOrden', () => ({ crearFabricacionFormula: m.crear }))

const fragmentos = bactipro as Fragmento[]
// Dos fórmulas: la misma hoja repetida en la página 2 con otro lote.
const dosFormulas: Fragmento[] = [
  ...fragmentos,
  ...fragmentos.map((f) => ({
    ...f,
    pagina: 2,
    str: f.str === '17702' ? '17703' : f.str,
  })),
]

const base: DatosOrden = {
  tanques: [
    {
      tanque_id: 't1',
      codigo: 'T-01',
      capacidad_l: 2000,
      estado: 'libre',
      fabricacion_id: null,
      producto: null,
      litros_restantes: null,
    },
    {
      tanque_id: 't2',
      codigo: 'T-02',
      capacidad_l: 2000,
      estado: 'libre',
      fabricacion_id: null,
      producto: null,
      litros_restantes: null,
    },
    {
      tanque_id: 't3',
      codigo: 'T-03',
      capacidad_l: 2000,
      estado: 'fabricando',
      fabricacion_id: 'f3',
      producto: 'Cloro',
      litros_restantes: 900,
    },
  ],
  productos: [
    { id: 'p1', nombre: 'Bactipro', color: '#0284c7', codigo: null },
    { id: 'p2', nombre: 'Lavandina', color: '#16a34a', codigo: null },
  ],
  presentaciones: [],
  etiquetas: [],
  operarias: [{ empleado_id: 'E1', nombre: 'Laura Paz' }],
  asignados: {},
  estandares: [],
  lotesAbiertos: [],
  fabricacionesAbiertas: [],
}

async function subir(datos: DatosOrden = base, fr: Fragmento[] = fragmentos) {
  m.extraer.mockResolvedValue(fr)
  const onCreadas = vi.fn()
  const onAlgunaCreada = vi.fn()
  render(<SubirFormula datos={datos} onCreadas={onCreadas} onAlgunaCreada={onAlgunaCreada} />)
  const archivo = new File(['%PDF'], 'BACTIPRO.pdf', {
    type: 'application/pdf',
  })
  await act(async () =>
    fireEvent.change(screen.getByLabelText('PDF de la fórmula'), {
      target: { files: [archivo] },
    }),
  )
  return { onCreadas, onAlgunaCreada }
}

const tarjeta = (lote: string) => screen.getByRole('region', { name: new RegExp(`Lote ${lote}`) })
const cambiar = (t: HTMLElement, etiqueta: string, valor: string) =>
  fireEvent.change(within(t).getByLabelText(etiqueta), {
    target: { value: valor },
  })
const completar = (t: HTMLElement, tanque: string) => {
  cambiar(t, 'Tanque', tanque)
  cambiar(t, 'Vencimiento', '2028-10-21')
}

beforeEach(() => {
  m.crear.mockReset()
})

describe('SubirFormula', () => {
  it('muestra una tarjeta por fórmula con sus MP', async () => {
    await subir()
    const t = tarjeta('17702')
    expect(within(t).getByRole('heading')).toHaveTextContent('Lote 17702 · Bactipro · 1000 L')
    const filas = within(within(t).getByRole('table')).getAllByRole('row')
    expect(filas).toHaveLength(5) // encabezado + 4 MP
    expect(within(t).getByText('900101')).toBeInTheDocument()
    expect(within(t).getByText('21/10/2026')).toBeInTheDocument()
  })

  it('precarga el producto por nombre', async () => {
    await subir()
    expect(within(tarjeta('17702')).getByLabelText('Producto')).toHaveValue('p1')
  })

  it('precarga el producto por código aunque el nombre no coincida', async () => {
    await subir({
      ...base,
      productos: [{ id: 'p9', nombre: 'Bacti Pro 2', color: '#000', codigo: 'F8' }],
    })
    expect(within(tarjeta('17702')).getByLabelText('Producto')).toHaveValue('p9')
  })

  it('coincidencia aproximada por nombre: la precarga pero avisa y no le asigna el código del PDF', async () => {
    m.crear.mockResolvedValue({ ok: true, id: 'x' })
    await subir({
      ...base,
      productos: [{ id: 'p5', nombre: 'Bactipro Plus', color: '#000', codigo: null }],
    })
    const t = tarjeta('17702')
    expect(within(t).getByLabelText('Producto')).toHaveValue('p5')
    expect(within(t).getByRole('status')).toHaveTextContent('Coincidencia aproximada: revisá el producto')
    completar(t, 't1')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.crear.mock.calls[0][0]).toMatchObject({ producto_id: 'p5', codigo_producto: '' })
  })

  it('coincidencia aproximada confirmada con «Es este producto»: le asigna el código', async () => {
    m.crear.mockResolvedValue({ ok: true, id: 'x' })
    await subir({
      ...base,
      productos: [{ id: 'p5', nombre: 'Bactipro Plus', color: '#000', codigo: null }],
    })
    const t = tarjeta('17702')
    fireEvent.click(within(t).getByRole('button', { name: 'Es este producto' }))
    expect(within(t).queryByText(/Coincidencia aproximada/)).toBeNull()
    completar(t, 't1')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.crear.mock.calls[0][0]).toMatchObject({ producto_id: 'p5', codigo_producto: 'F8' })
  })

  it('coincidencia aproximada y la encargada elige otro producto: ese sí lleva el código', async () => {
    m.crear.mockResolvedValue({ ok: true, id: 'x' })
    await subir({
      ...base,
      productos: [
        { id: 'p5', nombre: 'Bactipro Plus', color: '#000', codigo: null },
        { id: 'p6', nombre: 'Bacti Pro', color: '#000', codigo: null },
      ],
    })
    const t = tarjeta('17702')
    cambiar(t, 'Producto', 'p6')
    expect(within(t).queryByText(/Coincidencia aproximada/)).toBeNull()
    completar(t, 't1')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.crear.mock.calls[0][0]).toMatchObject({ producto_id: 'p6', codigo_producto: 'F8' })
  })

  it('producto elegido a mano cuando no hubo coincidencia: lleva el código', async () => {
    m.crear.mockResolvedValue({ ok: true, id: 'x' })
    await subir({ ...base, productos: [{ id: 'p2', nombre: 'Lavandina', color: '#16a34a', codigo: null }] })
    const t = tarjeta('17702')
    cambiar(t, 'Producto', 'p2')
    completar(t, 't1')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.crear.mock.calls[0][0]).toMatchObject({ producto_id: 'p2', codigo_producto: 'F8' })
  })

  it('si no encuentra el producto, avisa y deja elegirlo', async () => {
    await subir({
      ...base,
      productos: [{ id: 'p2', nombre: 'Lavandina', color: '#16a34a', codigo: null }],
    })
    const t = tarjeta('17702')
    expect(within(t).getByRole('status')).toHaveTextContent('No encontré «Bactipro» en productos')
    expect(within(t).getByLabelText('Producto')).toHaveValue('')
  })

  it('solo ofrece tanques libres', async () => {
    await subir()
    const opciones = within(within(tarjeta('17702')).getByLabelText('Tanque'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(opciones.some((o) => o?.includes('T-01'))).toBe(true)
    expect(opciones.some((o) => o?.includes('T-03'))).toBe(false)
  })

  it('Crear queda deshabilitado hasta elegir tanque y vencimiento', async () => {
    await subir()
    const t = tarjeta('17702')
    const crear = within(t).getByRole('button', { name: 'Crear' })
    expect(crear).toBeDisabled()
    // no queda deshabilitado en silencio: dice qué falta
    expect(within(t).getByText('Completá tanque y vencimiento')).toBeInTheDocument()
    cambiar(t, 'Tanque', 't1')
    expect(crear).toBeDisabled()
    expect(within(t).getByText('Completá vencimiento')).toBeInTheDocument()
    cambiar(t, 'Vencimiento', '2026-10-01')
    expect(within(t).getByText('El vencimiento tiene que ser posterior a la fecha de la fórmula')).toBeInTheDocument()
    expect(crear).toBeDisabled()
    expect(within(t).queryByText(/^Completá/)).toBeNull()
    cambiar(t, 'Vencimiento', '2028-10-21')
    expect(crear).toBeEnabled()
    expect(within(t).queryByText(/^Completá/)).toBeNull()
  })

  it('crea la fabricación con sus 4 MP y la marca como creada', async () => {
    m.crear.mockResolvedValue({ ok: true, id: 'nueva' })
    const { onCreadas } = await subir()
    const t = tarjeta('17702')
    completar(t, 't1')
    cambiar(t, 'Operaria (opcional)', 'E1')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.crear).toHaveBeenCalledTimes(1)
    const [fab, mp] = m.crear.mock.calls[0]
    expect(fab).toEqual({
      tanque_id: 't1',
      producto_id: 'p1',
      litros: 1000,
      lote: '17702',
      operaria_id: 'E1',
      vencimiento: '2028-10-21',
      fecha_formula: '2026-10-21',
      codigo_producto: 'F8',
    })
    expect(mp).toHaveLength(4)
    expect(within(t).getByText('Creada')).toBeInTheDocument()
    expect(within(t).queryByRole('button', { name: 'Crear' })).not.toBeInTheDocument()
    expect(onCreadas).toHaveBeenCalled()
  })

  it('avisa si el lote ya tiene una fabricación abierta y no deja crear', async () => {
    await subir({ ...base, lotesAbiertos: ['17702'] })
    const t = tarjeta('17702')
    completar(t, 't1')
    expect(within(t).getByText('Ya existe una fabricación con el lote 17702')).toBeInTheDocument()
    expect(within(t).getByRole('button', { name: 'Crear' })).toBeDisabled()
  })

  it('un tanque elegido en una tarjeta desaparece de las otras', async () => {
    await subir(base, dosFormulas)
    cambiar(tarjeta('17702'), 'Tanque', 't1')
    const opciones = within(within(tarjeta('17703')).getByLabelText('Tanque'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(opciones.some((o) => o?.includes('T-01'))).toBe(false)
    expect(opciones.some((o) => o?.includes('T-02'))).toBe(true)
  })

  it('Crear todas: la que falla muestra su error y queda para reintentar', async () => {
    m.crear.mockResolvedValueOnce({ ok: true, id: 'a' }).mockResolvedValueOnce({
      ok: false,
      codigo: 'LOTE_DUPLICADO',
      texto: 'Ya existe una fabricación con ese lote.',
    })
    const { onCreadas, onAlgunaCreada } = await subir(base, dosFormulas)
    completar(tarjeta('17702'), 't1')
    completar(tarjeta('17703'), 't2')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear todas' })))
    expect(m.crear).toHaveBeenCalledTimes(2)
    expect(within(tarjeta('17702')).getByText('Creada')).toBeInTheDocument()
    const segunda = tarjeta('17703')
    expect(within(segunda).getByRole('alert')).toHaveTextContent('Ya existe una fabricación con ese lote.')
    expect(within(segunda).getByRole('button', { name: 'Crear' })).toBeEnabled()
    expect(onCreadas).not.toHaveBeenCalled()
    expect(onAlgunaCreada).toHaveBeenCalledTimes(1)
  })

  it('si el PDF no tiene el formato, muestra el error', async () => {
    await subir(base, [])
    expect(screen.getByRole('alert')).toHaveTextContent('Este PDF no tiene el formato de Movimientos de Produccion. Cargá la orden a mano.')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('si el PDF no trae lote ni fecha, los pide', async () => {
    const sinLote = fragmentos.filter((f) => f.str !== '17702' && !/^\d{2}\/\d{2}\/\d{4}$/.test(f.str))
    m.crear.mockResolvedValue({ ok: true, id: 'x' })
    await subir(base, sinLote)
    const t = tarjeta('')
    completar(t, 't1')
    const crear = within(t).getByRole('button', { name: 'Crear' })
    expect(crear).toBeDisabled()
    cambiar(t, 'Lote', '17702')
    cambiar(t, 'Fecha de la fórmula', '2026-10-21')
    expect(crear).toBeEnabled()
    await act(async () => fireEvent.click(crear))
    expect(m.crear.mock.calls[0][0]).toMatchObject({
      lote: '17702',
      fecha_formula: '2026-10-21',
    })
  })
})
