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

  it('el escáner de hojas no se usa en la demo', async () => {
    const { supabase } = cliente()
    const r = await supabase.functions.invoke('escanear-hoja', { body: { tipo: 'fabricacion', imagen: 'x' } })
    expect(r.data).toMatchObject({ ok: false })
  })
})
