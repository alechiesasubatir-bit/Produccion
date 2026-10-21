import { describe, expect, it, vi } from 'vitest'
import { ejecutarAccion, verificarPin } from './acciones'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ db: { rpc: (...args: unknown[]) => rpc(...args) } }))

const base = { entidad: 'fabricacion' as const, id: 'f1', accion: 'finalizar' as const, empleadoId: 'E1', pin: '1234' }

describe('ejecutarAccion', () => {
  it('llama a la RPC con los nombres de parámetro exactos', async () => {
    rpc.mockResolvedValue({ data: { ok: true, fabricacion_cerrada: false }, error: null })
    await ejecutarAccion(base)
    expect(rpc).toHaveBeenLastCalledWith('accion', {
      p_entidad: 'fabricacion',
      p_id: 'f1',
      p_accion: 'finalizar',
      p_empleado_id: 'E1',
      p_pin: '1234',
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

describe('verificarPin', () => {
  it('PIN bloqueado', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'PIN_BLOQUEADO' }, error: null })
    expect(await verificarPin('E1', '1234')).toEqual({
      ok: false,
      codigo: 'PIN_BLOQUEADO',
      texto: 'Demasiados intentos. Esperá un minuto.',
    })
    expect(rpc).toHaveBeenLastCalledWith('verificar_pin', { p_empleado_id: 'E1', p_pin: '1234' })
  })

  it('PIN correcto', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await verificarPin('E1', '1234')).toEqual({ ok: true })
  })
})
