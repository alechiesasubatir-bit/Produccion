import { describe, expect, it, vi } from 'vitest'
import { accionPanel, corregirCantidad, ejecutarAccion, guardarConsumible, guardarMp, listarLiberadoras, registrarControl, setVencimiento } from './acciones'

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

describe('cantidades por operaria', () => {
  it('ejecutarAccion manda p_cantidades con empleado_id', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await ejecutarAccion({ ...base, cantidades: [{ empleadoId: 'e1', cantidad: 12.5, unidad: 'L' }] })
    expect(rpc).toHaveBeenLastCalledWith('accion', {
      p_entidad: 'fabricacion',
      p_id: 'f1',
      p_accion: 'finalizar',
      p_empleado_id: 'E1',
      p_cantidades: [{ empleado_id: 'e1', cantidad: 12.5, unidad: 'L' }],
    })
  })

  it('sin cantidades no manda p_cantidades', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await ejecutarAccion(base)
    expect(rpc.mock.lastCall?.[1]).not.toHaveProperty('p_cantidades')
  })

  it('corregirCantidad llama a la RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await corregirCantidad({ participacionId: 'p1', cantidad: 10, unidad: 'kg' })).toEqual({ ok: true })
    expect(rpc).toHaveBeenLastCalledWith('corregir_cantidad', {
      p_participacion_id: 'p1',
      p_cantidad: 10,
      p_unidad: 'kg',
    })
  })

  it('setVencimiento llama a la RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await setVencimiento({ fabricacionId: 'f1', fecha: '2027-01-31', empleadoId: 'e1' })).toEqual({ ok: true })
    expect(rpc).toHaveBeenLastCalledWith('set_vencimiento', {
      p_fab_id: 'f1',
      p_fecha: '2027-01-31',
      p_empleado_id: 'e1',
    })
  })

  it('corregirCantidad devuelve el rechazo de negocio', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'NO_AUTORIZADO' }, error: null })
    expect(await corregirCantidad({ participacionId: 'p1', cantidad: 10 })).toMatchObject({
      ok: false,
      codigo: 'NO_AUTORIZADO',
    })
  })
})

describe('registrarControl', () => {
  const c = {
    fabricacionId: 'f1',
    ph: 7.5,
    densidad: 1.02,
    perfumeOk: false,
    perfumeComentario: 'muy suave',
    visualOk: true,
    visualComentario: '',
    observaciones: '',
    resultado: 'rechazado' as const,
  }

  it('llama a registrar_control con los nombres de parámetro exactos, sin firmante en el panel', async () => {
    rpc.mockResolvedValue({ data: { ok: true, intento: 2 }, error: null })
    expect(await registrarControl(c)).toEqual({ ok: true, intento: 2 })
    expect(rpc).toHaveBeenLastCalledWith('registrar_control', {
      p_fab_id: 'f1',
      p_ph: 7.5,
      p_densidad: 1.02,
      p_perfume_ok: false,
      p_perfume_comentario: 'muy suave',
      p_visual_ok: true,
      p_visual_comentario: '',
      p_observaciones: '',
      p_resultado: 'rechazado',
    })
  })

  it('manda p_firmante cuando hay firmante (tablet) y pH/densidad nulos en polvo', async () => {
    rpc.mockResolvedValue({ data: { ok: true, intento: 1 }, error: null })
    await registrarControl({ ...c, ph: null, densidad: null, firmante: 'L1' })
    expect(rpc).toHaveBeenLastCalledWith('registrar_control', expect.objectContaining({ p_ph: null, p_densidad: null, p_firmante: 'L1' }))
  })

  it('rechazo de negocio', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'DATOS_INVALIDOS', detalle: 'falta pH' }, error: null })
    expect(await registrarControl(c)).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
  })
})

describe('listarLiberadoras', () => {
  it('devuelve la lista', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'L1', nombre: 'Marta Gómez' }], error: null })
    expect(await listarLiberadoras()).toEqual([{ id: 'L1', nombre: 'Marta Gómez' }])
    expect(rpc).toHaveBeenLastCalledWith('listar_liberadoras')
  })

  it('sin datos devuelve []', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await listarLiberadoras()).toEqual([])
  })

  it('lanza si la RPC falla (42501)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no autorizado', code: '42501' } })
    await expect(listarLiberadoras()).rejects.toMatchObject({ code: '42501' })
  })
})

describe('guardarConsumible', () => {
  it('llama a cargar_consumible con los parámetros exactos', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await guardarConsumible('c1', 'L9', 'E1')).toEqual({ ok: true })
    expect(rpc).toHaveBeenLastCalledWith('cargar_consumible', { p_id: 'c1', p_lote: 'L9', p_empleado_id: 'E1' })
  })
  it('rechazo de negocio', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'TRANSICION_INVALIDA' }, error: null })
    expect(await guardarConsumible('c1', 'L9')).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
  })
})
