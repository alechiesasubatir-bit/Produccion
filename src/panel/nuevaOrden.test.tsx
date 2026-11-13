import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DatosOrden } from './datosOrden'
import bactipro from '../domain/__fixtures__/bactipro.json'
import type { Fragmento } from '../domain/formulaPdf'
import { NuevaOrden } from './NuevaOrden'

const m = vi.hoisted(() => ({ crearOrden: vi.fn(), crearFormula: vi.fn(), extraer: vi.fn() }))

const datos: DatosOrden = {
  tanques: [
    { tanque_id: 't1', codigo: 'T-01', capacidad_l: 2000, estado: 'libre', fabricacion_id: null, producto: null, litros_restantes: null },
    { tanque_id: 't2', codigo: 'T-02', capacidad_l: 2000, estado: 'fabricando', fabricacion_id: 'fab2', producto: 'Cloro', litros_restantes: 1000 },
    { tanque_id: 't3', codigo: 'T-03', capacidad_l: 2000, estado: 'para_envasar', fabricacion_id: 'fab3', producto: 'Lavandina', litros_restantes: 300 },
    { tanque_id: 't4', codigo: 'T-04', capacidad_l: 2000, estado: 'libre', fabricacion_id: null, producto: null, litros_restantes: null },
  ],
  productos: [{ id: 'p1', nombre: 'Lavandina', color: '#0284c7', codigo: null }],
  presentaciones: [{ id: 'pr1', nombre: '5L', litros_equiv: 5 }],
  etiquetas: [{ id: 'et1', nombre: 'Etiqueta test' }],
  operarias: [{ empleado_id: 'E1', nombre: 'Laura Paz' }],
  asignados: { fab3: 200 },
  estandares: [{ entidad: 'fabricacion', clave: 'Lavandina', velocidad: 7.5, muestras: 2, litros_hora_std: null }],
  lotesAbiertos: [],
  fabricacionesAbiertas: [],
}

vi.mock('./datosOrden', () => ({
  cargarDatosOrden: () => Promise.resolve(datos),
  crearOrden: m.crearOrden,
  crearFabricacionFormula: m.crearFormula,
}))
vi.mock('./leerPdf', () => ({ extraerFragmentos: m.extraer }))

async function abrir(props: Partial<Parameters<typeof NuevaOrden>[0]> = {}) {
  const onCreada = vi.fn()
  const onCerrar = vi.fn()
  render(<NuevaOrden abierta onCerrar={onCerrar} onCreada={onCreada} {...props} />)
  await act(async () => {})
  return { onCreada, onCerrar }
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
    cambiar('Vencimiento', '2028-01-31')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear orden' })))
    expect(m.crearOrden).toHaveBeenLastCalledWith('fabricacion', {
      tanque_id: 't1',
      producto_id: 'p1',
      litros: 1200,
      lote: 'L-1',
      operaria_id: null,
      vencimiento: '2028-01-31',
    })
    expect(onCreada).toHaveBeenCalled()
  })
})

describe('NuevaOrden · PDF de fórmula', () => {
  it('en Fabricación alterna entre el formulario y la subida del PDF', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Subir PDF de fórmula' }))
    expect(campo('PDF de la fórmula')).toBeInTheDocument()
    expect(screen.queryByLabelText('Litros')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar a mano' }))
    expect(campo('Litros')).toBeInTheDocument()
  })

  it('si creó alguna y cierra con otra pendiente, avisa onCreada (para recargar el tablero)', async () => {
    const fr = bactipro as Fragmento[]
    m.extraer.mockResolvedValue([...fr, ...fr.map((f) => ({ ...f, pagina: 2, str: f.str === '17702' ? '17703' : f.str }))])
    m.crearFormula.mockResolvedValueOnce({ ok: true, id: 'a' }).mockResolvedValueOnce({ ok: false, codigo: 'TANQUE_OCUPADO', texto: 'x' })
    const { onCreada, onCerrar } = await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Subir PDF de fórmula' }))
    const archivo = new File(['%PDF'], 'B.pdf', { type: 'application/pdf' })
    await act(async () => fireEvent.change(campo('PDF de la fórmula'), { target: { files: [archivo] } }))
    for (const [lote, tanque] of [['17702', 't1'], ['17703', 't4']]) {
      const t = screen.getByRole('region', { name: new RegExp(`Lote ${lote}`) })
      fireEvent.change(within(t).getByLabelText('Tanque'), { target: { value: tanque } })
      fireEvent.change(within(t).getByLabelText('Producto'), { target: { value: 'p1' } })
      fireEvent.change(within(t).getByLabelText('Vencimiento'), { target: { value: '2028-10-21' } })
      await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    }
    expect(onCreada).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCreada).toHaveBeenCalledTimes(1)
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('sin crear nada, cerrar es solo cerrar', async () => {
    const { onCreada, onCerrar } = await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Subir PDF de fórmula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(onCreada).not.toHaveBeenCalled()
  })

  it('ya no existe el escaneo con IA; Envasado y Fraccionado son solo manuales', async () => {
    await abrir()
    expect(screen.queryByRole('button', { name: /escane/i })).not.toBeInTheDocument()
    for (const tipo of ['Envasado', 'Fraccionado']) {
      fireEvent.click(screen.getByRole('button', { name: tipo }))
      expect(screen.queryByRole('button', { name: /escane/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Subir PDF de fórmula' })).not.toBeInTheDocument()
    }
  })
})

describe('NuevaOrden · proyección', () => {
  it('muestra el tiempo estimado con la velocidad histórica', async () => {
    await abrir()
    cambiar('Tanque', 't1')
    cambiar('Producto', 'p1')
    cambiar('Litros', '600')
    expect(screen.getByText('~80 min (histórico 7,5 L/min)')).toBeInTheDocument()
  })
})

describe('NuevaOrden · envasado', () => {
  it('avisa si usa más de lo que queda sin asignar (descuenta envasados en cola) pero deja crear', async () => {
    await abrir({ tipoInicial: 'envasado' })
    expect(within(campo('Tanque a envasar')).getByRole('option', { name: /T-03/ })).toHaveTextContent('quedan 100 L sin asignar')
    cambiar('Tanque a envasar', 'fab3')
    cambiar('Presentación', 'pr1')
    cambiar('Cantidad', '40')
    expect(screen.getByRole('status')).toHaveTextContent('Quedan 100 L sin asignar en el tanque y esta orden usa 200 L.')
    expect(screen.getByRole('button', { name: 'Crear orden' })).toBeEnabled()
  })
})

describe('NuevaOrden · abierta desde un tanque listo', () => {
  it('Cargar envasado la abre en Envasado con ese tanque ya elegido', async () => {
    await abrir({ tipoInicial: 'envasado', fabricacionInicial: 'fab3' })
    expect(screen.getByRole('button', { name: 'Envasado' })).toHaveAttribute('aria-pressed', 'true')
    expect(campo('Tanque a envasar')).toHaveValue('fab3')
  })
})

describe('NuevaOrden · etiquetado Sí/No', () => {
  for (const [tipo, extra] of [['envasado', 'Tanque a envasar'], ['fraccionado', 'Tipo']] as const) {
    it(`${tipo}: No por defecto, Sí pide etiqueta activa`, async () => {
      await abrir({ tipoInicial: tipo })
      const grupo = screen.getByRole('group', { name: 'Etiquetado' })
      expect(within(grupo).getByRole('radio', { name: 'No' })).toBeChecked()
      expect(screen.queryByLabelText('Etiqueta')).not.toBeInTheDocument()
      fireEvent.click(within(grupo).getByRole('radio', { name: 'Sí' }))
      const opciones = within(campo('Etiqueta')).getAllByRole('option').map((o) => o.textContent)
      expect(opciones).toEqual(['Elegí una etiqueta', 'Etiqueta test'])
      expect(screen.getByText('Elegí una etiqueta.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Crear orden' })).toBeDisabled()
      expect(extra).toBeTruthy()
    })
  }

  it('envasado con etiqueta inserta etiqueta_id y no etiquetar', async () => {
    m.crearOrden.mockResolvedValue({ error: null })
    await abrir({ tipoInicial: 'envasado' })
    cambiar('Tanque a envasar', 'fab3')
    cambiar('Presentación', 'pr1')
    cambiar('Cantidad', '10')
    fireEvent.click(screen.getByRole('radio', { name: 'Sí' }))
    cambiar('Etiqueta', 'et1')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear orden' })))
    const [, datosIns] = m.crearOrden.mock.lastCall as [string, Record<string, unknown>]
    expect(datosIns.etiqueta_id).toBe('et1')
    expect(datosIns).not.toHaveProperty('etiquetar')
    expect(datosIns).not.toHaveProperty('etiquetado')
  })

  it('sin etiquetado manda etiqueta_id null', async () => {
    m.crearOrden.mockResolvedValue({ error: null })
    await abrir({ tipoInicial: 'fraccionado' })
    cambiar('Tipo', 'Sachet')
    cambiar('Cantidad', '5')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear orden' })))
    const [, datosIns] = m.crearOrden.mock.lastCall as [string, Record<string, unknown>]
    expect(datosIns.etiqueta_id).toBeNull()
  })

  it('ETIQUETA_INACTIVA del servidor se muestra', async () => {
    m.crearOrden.mockResolvedValue({ error: { code: 'PC001', message: 'ETIQUETA_INACTIVA' } })
    await abrir({ tipoInicial: 'fraccionado' })
    cambiar('Tipo', 'Sachet')
    cambiar('Cantidad', '5')
    fireEvent.click(screen.getByRole('radio', { name: 'Sí' }))
    cambiar('Etiqueta', 'et1')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear orden' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Esa etiqueta está desactivada.')
  })
})
