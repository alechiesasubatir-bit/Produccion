import { describe, expect, it, vi } from 'vitest'
import { crearEnvasadoDocumento, crearFraccionadoDocumento, crearGranelStock, editarEnvasado } from './datosOrden'

const rpc = vi.fn()
const eq = vi.fn()
const update = vi.fn(() => ({ eq }))
vi.mock('../lib/supabase', () => ({ db: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ update: (...a: unknown[]) => update(...(a as [])) }) } }))

const cons = [{ codigo: 'E1', descripcion: 'Envase', cantidad: 10 }]
const env = { fabricacion_id: null, granel_id: 'g1', presentacion_id: 'p1', cantidad: 10, lote: 'L1', codigo: 'C', descripcion: 'D', litros_granel: 15, etiqueta_id: null }

describe('crearEnvasadoDocumento', () => {
  it('llama a la RPC y devuelve el id', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 'e1' }, error: null })
    expect(await crearEnvasadoDocumento(env, cons)).toEqual({ ok: true, id: 'e1' })
    expect(rpc).toHaveBeenLastCalledWith('crear_envasado_documento', { p_env: env, p_consumibles: cons })
  })
  it('error de negocio', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'DATOS_INVALIDOS' }, error: null })
    expect(await crearEnvasadoDocumento(env, cons)).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
  })
})

describe('crearFraccionadoDocumento', () => {
  it('llama a la RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 'f1' }, error: null })
    const frac = { producto_id: 'p', presentacion_id: 'q', cantidad: 3, lote: 'L', codigo: 'C', descripcion: 'D', etiqueta_id: null }
    expect(await crearFraccionadoDocumento(frac, cons)).toEqual({ ok: true, id: 'f1' })
    expect(rpc).toHaveBeenLastCalledWith('crear_fraccionado_documento', { p_frac: frac, p_consumibles: cons })
  })
})

describe('crearGranelStock', () => {
  it('mapea a p_*', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 'g1' }, error: null })
    expect(await crearGranelStock({ tanque_id: 't', producto_id: 'p', litros: 500, lote: 'L' })).toEqual({ ok: true, id: 'g1' })
    expect(rpc).toHaveBeenLastCalledWith('crear_granel_stock', { p_tanque_id: 't', p_producto_id: 'p', p_litros: 500, p_lote: 'L' })
  })
})

describe('editarEnvasado', () => {
  it('actualiza y devuelve ok', async () => {
    eq.mockResolvedValue({ error: null })
    expect(await editarEnvasado('e1', { cantidad: 5 })).toEqual({ ok: true })
    expect(update).toHaveBeenLastCalledWith({ cantidad: 5 })
    expect(eq).toHaveBeenLastCalledWith('id', 'e1')
  })
  it.each(['NO_EDITABLE', 'TANQUE_EN_USO', 'GRANEL_DISTINTO', 'SIN_TANQUE'])('mapea %s del trigger', async (message) => {
    eq.mockResolvedValue({ error: { message, code: 'PC001' } })
    expect(await editarEnvasado('e1', { fabricacion_id: 'f' })).toMatchObject({ ok: false, codigo: message })
  })
})
