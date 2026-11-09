import { describe, expect, it, vi } from 'vitest'
import { accionPanel, ejecutarAccion, guardarMp } from './acciones'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ db: { rpc: (...args: unknown[]) => rpc(...args) } }))

const base = { entidad: 'fabricacion' as const, id: 'f1', accion: 'finalizar' as const, empleadoId: 'E1' }

describe('ejecutarAccion', () => {
  it('llama a la RPC con los nombres de parámetro exactos', async () => {
    rpc.mockResolvedValue({ data: { ok: true, fabricacion_cerrada: false }, error: null })
    await ejecutarAccion(base)
    expect(rpc).toHaveBeenLastCalledWith('accion', {
      p_entidad: 'fabricacion',
      p_id: 'f1',
      p_accion: 'finalizar',
      p_empleado_id: 'E1',
    })
  })

  it('éxito con cierre de fabricación', async () => {
    rpc.mockResolvedValue({ data: { ok: true, fabricacion_cerrada: true }, error: null })
    expect(await ejecutarAccion(base)).toEqual({ ok: true, fabricacionCerrada: true })
  })

  it('rechazo de negocio con detalle', async () => {
    rpc.mockResolvedValue({
      data: { ok: false, codigo: 'TRANSICION_INVALIDA', detalle: 'ya la finalizó Laura Paz a las 14:02' },
      error: null,
    })
    expect(await ejecutarAccion(base)).toEqual({
      ok: false,
      codigo: 'TRANSICION_INVALIDA',
      texto: 'Esta tarea ya la finalizó Laura Paz a las 14:02.',
    })
  })

  it('sin red', async () => {
    // Sin beforeEach(mockClear/mockReset): en Vitest 5 eso hace que el rechazo del mock se reporte como fallo.
    rpc.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await ejecutarAccion(base)).toMatchObject({ ok: false, codigo: 'RED' })
  })

  it('falla de red como la devuelve postgrest-js (resuelve con error, no rechaza)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } })
    expect(await ejecutarAccion(base)).toMatchObject({ ok: false, codigo: 'RED' })
  })

  it('falla de red en Safari', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Load failed', code: '' } })
    expect(await ejecutarAccion(base)).toMatchObject({ ok: false, codigo: 'RED' })
  })

  it('error de PostgREST', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NO_AUTORIZADO' } })
    expect(await ejecutarAccion(base)).toMatchObject({ ok: false, codigo: 'NO_AUTORIZADO' })
  })
})

describe('accionPanel', () => {
  it('acciona sin operaria', async () => {
    rpc.mockResolvedValue({ data: { ok: true, fabricacion_cerrada: true }, error: null })
    expect(await accionPanel({ entidad: 'envasado', id: 'v1', accion: 'cancelar' })).toEqual({ ok: true, fabricacionCerrada: true })
    expect(rpc).toHaveBeenLastCalledWith('accion', { p_entidad: 'envasado', p_id: 'v1', p_accion: 'cancelar' })
  })
})

describe('guardarMp', () => {
  it('llama a cargar_mp con los nombres de parámetro exactos', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await guardarMp({ id: 'mp1', lote: 'L123', pesado: true, empleadoId: 'E1' })
    expect(rpc).toHaveBeenLastCalledWith('cargar_mp', {
      p_mp_id: 'mp1',
      p_lote: 'L123',
      p_pesado: true,
      p_empleado_id: 'E1',
    })
  })

  it('éxito', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await guardarMp({ id: 'mp1', lote: 'L123', pesado: true })).toEqual({ ok: true })
  })

  it('rechazo de negocio', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'TRANSICION_INVALIDA' }, error: null })
    expect(await guardarMp({ id: 'mp1', lote: 'L123', pesado: false })).toEqual({
      ok: false,
      codigo: 'TRANSICION_INVALIDA',
      texto: 'Esta tarea ya cambió de estado.',
    })
  })
})
