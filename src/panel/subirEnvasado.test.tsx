import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import bactipro from '../domain/__fixtures__/bactipro.json'
import envasado from '../domain/__fixtures__/envasado-limpiador.json'
import fraccionado from '../domain/__fixtures__/fraccionado-polvo.json'
import type { Fragmento } from '../domain/formulaPdf'
import type { DatosOrden } from './datosOrden'
import { SubirEnvasado } from './SubirEnvasado'
import { SubirFormula } from './SubirFormula'

const m = vi.hoisted(() => ({ extraer: vi.fn(), env: vi.fn(), frac: vi.fn(), stock: vi.fn(), formula: vi.fn(), lotes: vi.fn() }))

vi.mock('./leerPdf', () => ({ extraerFragmentos: m.extraer }))
vi.mock('./datosOrden', () => ({
  crearEnvasadoDocumento: m.env,
  crearFraccionadoDocumento: m.frac,
  crearGranelStock: m.stock,
  cargarLotesDocumento: m.lotes,
  crearFabricacionFormula: m.formula,
}))

const base: DatosOrden = {
  tanques: [
    { tanque_id: 't1', codigo: 'T-01', capacidad_l: 2000, estado: 'libre', fabricacion_id: null, producto: null, litros_restantes: null },
    { tanque_id: 't3', codigo: 'T-03', capacidad_l: 2000, estado: 'fabricando', fabricacion_id: 'f1', producto: 'Limpiador Prueba', litros_restantes: 900 },
  ],
  productos: [{ id: 'pl', nombre: 'Limpiador Prueba', color: '#000', codigo: 'F9' }],
  presentaciones: [
    { id: 'p15', nombre: '1.5L', litros_equiv: 1.5 },
    { id: 'p5', nombre: '5L', litros_equiv: 5 },
    { id: 'p10', nombre: '10L', litros_equiv: 10 },
    { id: 'p500', nombre: '500g', litros_equiv: 0.5 },
  ],
  etiquetas: [],
  operarias: [],
  asignados: {},
  estandares: [],
  lotesAbiertos: [],
  fabricacionesAbiertas: [],
}
const abierta = (id: string, tanque = 't3') => ({ id, producto_id: 'pl', tanque_id: tanque, lote: 'L1', litros: 900, sinAsignar: 900 })

async function subir(opts: { datos?: DatosOrden; tipo?: 'envasado' | 'fraccionado'; fr?: unknown } = {}) {
  const { datos = base, tipo = 'envasado', fr = envasado } = opts
  m.extraer.mockResolvedValue(fr as Fragmento[])
  const onCreadas = vi.fn()
  const onAlgunaCreada = vi.fn()
  const onOtroTipo = vi.fn()
  render(<SubirEnvasado datos={datos} tipo={tipo} onCreadas={onCreadas} onAlgunaCreada={onAlgunaCreada} onOtroTipo={onOtroTipo} />)
  const archivo = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })
  await act(async () => fireEvent.change(screen.getByLabelText('PDF de envasado'), { target: { files: [archivo] } }))
  return { onCreadas, onAlgunaCreada, onOtroTipo, archivo }
}

const tarjetas = () => screen.getAllByRole('region')
const campo = (t: HTMLElement, e: string) => within(t).getByLabelText(e)
const cambiar = (t: HTMLElement, e: string, v: string) => fireEvent.change(campo(t, e), { target: { value: v } })

beforeEach(() => {
  m.env.mockReset().mockResolvedValue({ ok: true, id: 'e1' })
  m.frac.mockReset().mockResolvedValue({ ok: true, id: 'fr1' })
  m.stock.mockReset().mockResolvedValue({ ok: true, id: 'g1' })
  m.lotes.mockReset().mockResolvedValue(new Set())
})

describe('SubirEnvasado', () => {
  it('muestra una tarjeta por bloque con la presentación preseleccionada', async () => {
    await subir()
    const ts = tarjetas()
    expect(ts).toHaveLength(3)
    expect(campo(ts[0], 'Presentación')).toHaveValue('p15')
    expect(campo(ts[1], 'Presentación')).toHaveValue('p5')
    expect(campo(ts[2], 'Presentación')).toHaveValue('p10')
    expect(campo(ts[0], 'Producto del granel')).toHaveValue('pl')
    expect(campo(ts[0], 'Cantidad')).toHaveValue(600)
    expect(within(ts[0]).getByText('Consumibles (3)')).toBeInTheDocument()
  })

  it('una fabricación abierta del granel queda preseleccionada', async () => {
    await subir({ datos: { ...base, fabricacionesAbiertas: [abierta('f1')] } })
    expect(campo(tarjetas()[0], 'Tanque')).toHaveValue('f1')
  })

  it('dos fabricaciones abiertas: sin preselección', async () => {
    await subir({ datos: { ...base, fabricacionesAbiertas: [abierta('f1'), abierta('f2', 't1')] } })
    expect(campo(tarjetas()[0], 'Tanque')).toHaveValue('')
  })

  it('esperando fabricación: crea con fabricacion_id null', async () => {
    const { onAlgunaCreada } = await subir()
    const t = tarjetas()[0]
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.env).toHaveBeenCalledTimes(1)
    const [env, consumibles] = m.env.mock.calls[0]
    expect(env).toMatchObject({
      fabricacion_id: null,
      granel_id: 'pl',
      presentacion_id: 'p15',
      cantidad: 600,
      lote: '99001',
      codigo: '900301',
      litros_granel: 900,
      etiqueta_id: null,
    })
    expect(consumibles).toHaveLength(3)
    expect(onAlgunaCreada).toHaveBeenCalled()
    expect(within(t).getByText('Creada')).toBeInTheDocument()
  })

  it('granel de stock: crea el granel y usa su id', async () => {
    await subir()
    const t = tarjetas()[0]
    cambiar(t, 'Tanque', '__stock')
    cambiar(t, 'Tanque libre', 't1')
    cambiar(t, 'Litros del granel', '900')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.stock).toHaveBeenCalledWith({ tanque_id: 't1', producto_id: 'pl', litros: 900, lote: null })
    expect(m.env.mock.calls[0][0]).toMatchObject({ fabricacion_id: 'g1' })
    expect(m.stock.mock.invocationCallOrder[0]).toBeLessThan(m.env.mock.invocationCallOrder[0])
  })

  it('granel de stock: si el envasado falla, al reintentar no crea otro granel', async () => {
    m.env.mockResolvedValueOnce({ ok: false, texto: 'Falló.' })
    await subir()
    const t = tarjetas()[0]
    cambiar(t, 'Tanque', '__stock')
    cambiar(t, 'Tanque libre', 't1')
    cambiar(t, 'Litros del granel', '900')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(within(t).getByRole('alert')).toHaveTextContent('Falló.')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.stock).toHaveBeenCalledTimes(1)
    expect(m.env).toHaveBeenCalledTimes(2)
    expect(m.env.mock.calls[1][0]).toMatchObject({ fabricacion_id: 'g1' })
  })

  it('un granel de stock sirve a las demás tarjetas del mismo granel', async () => {
    const grande = { tanque_id: 't2', codigo: 'T-02', capacidad_l: 5000, estado: 'libre', fabricacion_id: null, producto: null, litros_restantes: null }
    await subir({ datos: { ...base, tanques: [...base.tanques, grande] } })
    const [t1, t2, t3] = tarjetas()
    cambiar(t1, 'Tanque', '__stock')
    // litros = suma de los tres bloques del mismo granel (900 + 500 + 1800)
    expect(campo(t1, 'Litros del granel')).toHaveValue(3200)
    cambiar(t1, 'Tanque libre', 't2')
    m.env.mockResolvedValueOnce({ ok: false, texto: 'Falló.' })
    await act(async () => fireEvent.click(within(t1).getByRole('button', { name: 'Crear' })))
    expect(m.stock).toHaveBeenCalledWith({ tanque_id: 't2', producto_id: 'pl', litros: 3200, lote: null })
    // con el granel creado, la tarjeta ya no cambia de tanque
    expect(campo(t1, 'Tanque')).toBeDisabled()
    // las otras lo ven como fabricación abierta y no como tanque libre
    expect(within(campo(t2, 'Tanque')).getByRole('option', { name: /T-02/ })).toHaveValue('g1')
    cambiar(t3, 'Tanque', '__stock')
    const libres = within(campo(t3, 'Tanque libre')).getAllByRole('option').map((o) => o.textContent)
    expect(libres.some((x) => x?.includes('T-02'))).toBe(false)
    cambiar(t2, 'Tanque', 'g1')
    await act(async () => fireEvent.click(within(t2).getByRole('button', { name: 'Crear' })))
    expect(m.env.mock.calls.at(-1)?.[0]).toMatchObject({ fabricacion_id: 'g1', cantidad: expect.any(Number) })
    expect(m.stock).toHaveBeenCalledTimes(1)
  })

  it('lote duplicado: avisa y no crea hasta confirmar', async () => {
    m.lotes.mockResolvedValue(new Set(['99001']))
    await subir()
    expect(m.lotes).toHaveBeenCalledWith('envasado', ['99001'])
    const t = tarjetas()[0]
    expect(within(t).getByText(/Este documento ya se cargó \(lote 99001\)\. ¿Crear igual\?/)).toBeInTheDocument()
    expect(within(t).getByRole('button', { name: 'Crear' })).toBeDisabled()
    fireEvent.click(within(t).getByRole('button', { name: 'Crear igual' }))
    expect(within(t).getByRole('button', { name: 'Crear' })).toBeEnabled()
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.env).toHaveBeenCalledTimes(1)
  })

  it('doble click no duplica', async () => {
    m.env.mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true, id: 'e1' }), 10)))
    await subir()
    const b = within(tarjetas()[0]).getByRole('button', { name: 'Crear' })
    await act(async () => {
      fireEvent.click(b)
      fireEvent.click(b)
    })
    expect(m.env).toHaveBeenCalledTimes(1)
  })

  it('«Crear todas» crea las tres en orden', async () => {
    const { onCreadas } = await subir()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Crear todas' })))
    expect(m.env).toHaveBeenCalledTimes(3)
    expect(onCreadas).toHaveBeenCalledTimes(1)
  })

  it('doble click en «Crear todas» no duplica', async () => {
    // La primera demora más que las otras: así el segundo recorrido alcanza a las ya terminadas.
    let n = 0
    m.env.mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true, id: 'e1' }), n++ === 0 ? 50 : 5)))
    await subir()
    const b = screen.getByRole('button', { name: 'Crear todas' })
    await act(async () => {
      fireEvent.click(b)
      fireEvent.click(b)
      await new Promise((r) => setTimeout(r, 300))
    })
    expect(m.env).toHaveBeenCalledTimes(3)
  })

  it('avisa si los litros exceden lo que queda sin asignar', async () => {
    await subir({ datos: { ...base, fabricacionesAbiertas: [{ ...abierta('f1'), sinAsignar: 100 }] } })
    expect(within(tarjetas()[0]).getByText(/Quedan 100 L sin asignar en el tanque y esta orden usa 900 L\./)).toBeInTheDocument()
  })

  it('fraccionado: sin tanque, crea el fraccionado', async () => {
    await subir({ tipo: 'fraccionado', fr: fraccionado })
    const t = tarjetas()[0]
    expect(within(t).queryByLabelText('Tanque')).toBeNull()
    expect(campo(t, 'Presentación')).toHaveValue('p500')
    await act(async () => fireEvent.click(within(t).getByRole('button', { name: 'Crear' })))
    expect(m.frac.mock.calls[0][0]).toMatchObject({ lote: '99002', cantidad: 120, presentacion_id: 'p500', producto_id: null })
    expect(m.env).not.toHaveBeenCalled()
  })

  it('bloques del otro tipo no se muestran y se avisa cuántos', async () => {
    await subir({ tipo: 'fraccionado' })
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    expect(screen.getByText(/Se omitieron 3 renglones de envasado/)).toBeInTheDocument()
  })

  it('una fórmula subida en Envasado avisa con onOtroTipo(fabricacion)', async () => {
    const { onOtroTipo, archivo } = await subir({ fr: bactipro })
    expect(onOtroTipo).toHaveBeenCalledWith('fabricacion', 'Es una fórmula: la abrí en Fabricación.', archivo)
    expect(screen.queryAllByRole('region')).toHaveLength(0)
  })
})

describe('SubirFormula con una hoja de envasado', () => {
  it('avisa con onOtroTipo(envasado)', async () => {
    m.extraer.mockResolvedValue(envasado as Fragmento[])
    const onOtroTipo = vi.fn()
    render(<SubirFormula datos={base} onCreadas={vi.fn()} onOtroTipo={onOtroTipo} />)
    const archivo = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })
    await act(async () => fireEvent.change(screen.getByLabelText('PDF de la fórmula'), { target: { files: [archivo] } }))
    expect(onOtroTipo).toHaveBeenCalledWith('envasado', 'Es una hoja de envasado: la abrí en Envasado.', archivo)
  })
})
