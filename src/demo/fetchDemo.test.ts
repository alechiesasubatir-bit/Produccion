import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../lib/database.types'
import { mensajeError } from '../lib/errores'
import { crearFetchDemo } from './fetchDemo'
import { crearSimulador } from './simulador'

const INICIO = Date.parse('2026-10-21T09:00:00-03:00')

function cliente(onCambio = vi.fn()) {
  const sim = crearSimulador({ inicio: INICIO, semilla: 4, calentar: 0, autonomo: false })
  const supabase = createClient<Database>('https://demo.invalid', 'demo', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: crearFetchDemo(sim, onCambio) },
  })
  return { sim, supabase, db: supabase.schema('produccion'), onCambio }
}

describe('fetch de la demo (contrato PostgREST sobre el simulador)', () => {
  it('lista vistas con orden y rango, como fetchAll', async () => {
    const { db } = cliente()
    const { data, error } = await db.from('v_tanque_estado').select('*').order('orden').range(0, 999)
    expect(error).toBeNull()
    expect(data).toHaveLength(16)
    expect(data?.[0]).toMatchObject({ codigo: 'T-01', estado: 'libre' })
  })

  it('aplica filtros eq e in', async () => {
    const { db, sim } = cliente()
    sim.insertar('fabricaciones', { tanque_id: 'dt1', producto_id: 'dp1', litros: 100, lote: 'L-1' })
    const fab = sim.consultar('v_flujo')[0].id as string
    sim.insertar('envasados', { fabricacion_id: fab, presentacion_id: 'dr2', cantidad: 50 })
    const activos = await db.from('presentaciones').select('id, nombre').eq('activo', true)
    expect(activos.data?.length).toBeGreaterThan(0)
    const abiertos = await db.from('envasados').select('fabricacion_id, cantidad').in('estado', ['cola', 'activo'])
    expect(abiertos.data).toEqual([expect.objectContaining({ fabricacion_id: fab, cantidad: 50 })])
    const ninguno = await db.from('envasados').select('id').eq('fabricacion_id', 'otra')
    expect(ninguno.data).toEqual([])
  })

  it('una nueva orden aparece en el flujo; el tanque ocupado da el error de la base', async () => {
    const onCambio = vi.fn()
    const { db } = cliente(onCambio)
    const alta = { tanque_id: 'dt2', producto_id: 'dp2', litros: 800, lote: 'L-77' }
    expect((await db.from('fabricaciones').insert(alta as never)).error).toBeNull()
    expect(onCambio).toHaveBeenCalled()
    const flujo = await db.from('v_flujo').select('*')
    expect(flujo.data).toEqual([expect.objectContaining({ lote: 'L-77', estado: 'cola', tanque_codigo: 'T-02' })])
    const repetida = await db.from('fabricaciones').insert(alta as never)
    expect(mensajeError(repetida.error).codigo).toBe('TANQUE_OCUPADO')
  })

  it('las acciones van por rpc/accion con la respuesta del RPC real', async () => {
    const { db, sim, onCambio } = cliente()
    sim.insertar('fabricaciones', { tanque_id: 'dt3', producto_id: 'dp3', litros: 300, lote: 'L-3' })
    const id = sim.consultar('v_flujo')[0].id as string
    const ok = await db.rpc('accion', { p_entidad: 'fabricacion', p_id: id, p_accion: 'iniciar' } as never)
    expect(ok.data).toMatchObject({ ok: true })
    expect(onCambio).toHaveBeenCalled()
    const mal = await db.rpc('accion', { p_entidad: 'fabricacion', p_id: id, p_accion: 'iniciar' } as never)
    expect(mal.data).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
  })

  it('rpc/crear_fabricacion_formula crea la fabricación con sus MP; fabricacion_mp las devuelve en orden', async () => {
    const { db, onCambio } = cliente()
    const fab = { tanque_id: 'dt4', producto_id: 'dp1', litros: 1000, lote: '17702', vencimiento: '2028-11-06', fecha_formula: '2026-11-06' }
    const mp = [
      { codigo: 'MP1', descripcion: 'Agua', cantidad: 900 },
      { codigo: 'MP2', descripcion: 'Tensioactivo', cantidad: 100 },
    ]
    const r = await db.rpc('crear_fabricacion_formula', { p_fab: fab, p_mp: mp } as never)
    expect(r.data).toMatchObject({ ok: true, id: expect.any(String) })
    expect(onCambio).toHaveBeenCalled()
    const id = (r.data as { id: string }).id
    const filas = await db.from('fabricacion_mp').select('*').eq('fabricacion_id', id).order('orden')
    expect(filas.data).toEqual([
      expect.objectContaining({ fabricacion_id: id, orden: 1, codigo: 'MP1', descripcion: 'Agua', cantidad: 900, lote: null, pesado: false }),
      expect.objectContaining({ fabricacion_id: id, orden: 2, codigo: 'MP2', lote: null, pesado: false }),
    ])
    const flujo = await db.from('v_flujo').select('*')
    expect(flujo.data).toEqual([expect.objectContaining({ id, lote: '17702', tanque_codigo: 'T-04' })])

    const lote = await db.rpc('crear_fabricacion_formula', { p_fab: { ...fab, tanque_id: 'dt5' }, p_mp: mp } as never)
    expect(lote.data).toMatchObject({ ok: false, codigo: 'LOTE_DUPLICADO' })
    const tanque = await db.rpc('crear_fabricacion_formula', { p_fab: { ...fab, lote: '17703' }, p_mp: mp } as never)
    expect(tanque.data).toMatchObject({ ok: false, codigo: 'TANQUE_OCUPADO' })
    const mal = await db.rpc('crear_fabricacion_formula', { p_fab: { ...fab, tanque_id: 'dt6', lote: '17704', litros: 0 }, p_mp: mp } as never)
    expect(mal.data).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
  })

  it('rpc/cargar_mp completa la MP; finalizar con MP incompleta da MP_INCOMPLETA; v_tareas trae el avance', async () => {
    const { db } = cliente()
    const fab = { tanque_id: 'dt4', producto_id: 'dp1', litros: 1000, lote: '17702' }
    const mp = [
      { codigo: 'MP1', descripcion: 'Agua', cantidad: 900 },
      { codigo: 'MP2', descripcion: 'Tensioactivo', cantidad: 100 },
    ]
    const id = ((await db.rpc('crear_fabricacion_formula', { p_fab: fab, p_mp: mp } as never)).data as { id: string }).id
    const filas = (await db.from('fabricacion_mp').select('*').eq('fabricacion_id', id).order('orden')).data as { id: string }[]

    // en cola todavía no se carga
    const antes = await db.rpc('cargar_mp', { p_mp_id: filas[0].id, p_lote: 'A1', p_pesado: true, p_empleado_id: 'do1', p_pin: '1234' } as never)
    expect(antes.data).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
    await db.rpc('accion', { p_entidad: 'fabricacion', p_id: id, p_accion: 'iniciar' } as never)

    const tarea = async () => ((await db.from('v_tareas').select('*')).data ?? []).find((t) => t.id === id)
    expect(await tarea()).toMatchObject({ entidad: 'fabricacion', estado: 'fabricando', lote: '17702', mp_total: 2, mp_completas: 0 })

    const ok = await db.rpc('cargar_mp', { p_mp_id: filas[0].id, p_lote: ' A1 ', p_pesado: true, p_empleado_id: 'do1', p_pin: '1234' } as never)
    expect(ok.data).toEqual({ ok: true })
    const fila = (await db.from('fabricacion_mp').select('*').eq('id', filas[0].id)).data?.[0]
    expect(fila).toMatchObject({ lote: 'A1', pesado: true, cargado_por: 'do1', cargado_at: expect.any(String) })
    expect(await tarea()).toMatchObject({ mp_total: 2, mp_completas: 1 })
    const noExiste = await db.rpc('cargar_mp', { p_mp_id: 'nada', p_lote: 'x', p_pesado: true } as never)
    expect(noExiste.data).toMatchObject({ ok: false, codigo: 'NO_ENCONTRADO' })

    const fin = await db.rpc('accion', { p_entidad: 'fabricacion', p_id: id, p_accion: 'finalizar' } as never)
    expect(fin.data).toMatchObject({ ok: false, codigo: 'MP_INCOMPLETA', detalle: '1' })

    // lote en blanco no cuenta como completa
    await db.rpc('cargar_mp', { p_mp_id: filas[1].id, p_lote: '  ', p_pesado: true } as never)
    expect(await tarea()).toMatchObject({ mp_completas: 1 })
    await db.rpc('cargar_mp', { p_mp_id: filas[1].id, p_lote: 'B2', p_pesado: true } as never)
    expect(await tarea()).toMatchObject({ mp_completas: 2 })
    const listo = await db.rpc('accion', { p_entidad: 'fabricacion', p_id: id, p_accion: 'finalizar' } as never)
    expect(listo.data).toMatchObject({ ok: true })
  })

  it('v_tareas: envasado y fraccionado van con 0/0 MP; una fabricación sin fórmula también', async () => {
    const { db, sim } = cliente()
    sim.insertar('fabricaciones', { tanque_id: 'dt1', producto_id: 'dp1', litros: 100, lote: 'L-1' })
    const fab = sim.consultar('v_flujo')[0].id as string
    sim.insertar('envasados', { fabricacion_id: fab, presentacion_id: 'dr2', cantidad: 50 })
    const tareas = (await db.from('v_tareas').select('*').order('created_at')).data ?? []
    expect(tareas.map((t) => [t.entidad, t.mp_total, t.mp_completas])).toEqual([
      ['fabricacion', 0, 0],
      ['envasado', 0, 0],
    ])
  })

  it('rutas nuevas: etiquetas, participaciones, corregir_cantidad, set_vencimiento y listar_usuarios', async () => {
    const { db, sim } = cliente()
    const etiquetas = await db.from('etiquetas').select('id, nombre').eq('activo', true).order('nombre')
    expect(etiquetas.data).toEqual([expect.objectContaining({ nombre: 'Etiqueta Demo A' }), expect.objectContaining({ nombre: 'Etiqueta Demo B' })])

    sim.insertar('fabricaciones', { tanque_id: 'dt1', producto_id: 'dp1', litros: 100, lote: 'L-1' })
    const fab = sim.consultar('v_flujo')[0].id as string
    const venc = await db.rpc('set_vencimiento', { p_fab_id: fab, p_fecha: '2028-05-05' } as never)
    expect(venc.data).toEqual({ ok: true })
    expect((await db.from('fabricaciones').select('*').eq('id', fab)).data?.[0]).toMatchObject({ vencimiento: '2028-05-05' })

    await db.rpc('accion', { p_entidad: 'fabricacion', p_id: fab, p_accion: 'iniciar', p_empleado_id: 'do1' } as never)
    const ya = await db.rpc('accion', { p_entidad: 'fabricacion', p_id: fab, p_accion: 'sumarse', p_empleado_id: 'do1' } as never)
    expect(ya.data).toMatchObject({ ok: false, codigo: 'YA_PARTICIPA' })
    await db.rpc('accion', { p_entidad: 'fabricacion', p_id: fab, p_accion: 'sumarse', p_empleado_id: 'do2' } as never)
    const salir = await db.rpc('accion', { p_entidad: 'fabricacion', p_id: fab, p_accion: 'salir', p_empleado_id: 'do2', p_cantidades: [] } as never)
    expect(salir.data).toMatchObject({ ok: true })

    const partes = await db.from('participaciones').select('*').eq('entidad', 'fabricacion').eq('entidad_id', fab).order('desde')
    expect(partes.data).toHaveLength(2)
    const cerrada = partes.data?.find((p) => p.empleado_id === 'do2')
    const corr = await db.rpc('corregir_cantidad', { p_participacion_id: cerrada?.id, p_cantidad: 25, p_unidad: 'L' } as never)
    expect(corr.data).toEqual({ ok: true })
    const dp = await db.from('participaciones').select('*').eq('id', cerrada?.id as string)
    expect(dp.data?.[0]).toMatchObject({ cantidad_corregida: 25, corregida_por: expect.any(String) })

    const usuarios = await db.rpc('listar_usuarios')
    expect(usuarios.data).toEqual([expect.objectContaining({ id: dp.data?.[0].corregida_por, nombre: expect.any(String) })])
  })
})
