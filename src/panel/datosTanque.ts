import { db } from '../lib/supabase'
import { listarUsuarios } from './config/datosPersonas'
import type { Entidad } from '../domain/acciones'
import { esperadoEnvasado, type Unidad } from '../domain/participaciones'
import type { EventoRecorrido } from '../domain/recorrido'

export type { EventoRecorrido }
export type DatosFabricacion = { lote: string | null; vencimiento: string | null }

// Lote y vencimiento de la fabricación en curso, para mostrarlos en el detalle del tanque.
export async function cargarFabricacion(fabricacionId: string): Promise<DatosFabricacion | null> {
  const { data, error } = await db.from('fabricaciones').select('lote, vencimiento').eq('id', fabricacionId).maybeSingle()
  if (error) throw error
  return data
}

// Eventos de una fabricación y de sus envasados, con el nombre de quién los hizo.
export async function cargarRecorrido(fabricacionId: string): Promise<EventoRecorrido[]> {
  const envasados = await db.from('envasados').select('id').eq('fabricacion_id', fabricacionId)
  if (envasados.error) throw envasados.error
  const ids = [fabricacionId, ...(envasados.data ?? []).map((e) => e.id)]

  const [eventos, operarias] = await Promise.all([
    db.from('eventos').select('at, accion, empleado_id, usuario_id, entidad, datos').in('entidad_id', ids).order('at'),
    db.from('v_operarias').select('empleado_id, nombre'),
  ])
  if (eventos.error) throw eventos.error
  const nombres = new Map((operarias.data ?? []).map((o) => [o.empleado_id, o.nombre]))
  const lista = eventos.data ?? []

  // Nombres de quienes usaron el panel (solo si hay correcciones o ediciones de encargada).
  let usuarios = new Map<string, string | null>()
  if (lista.some((e) => e.usuario_id && !e.empleado_id)) {
    const us = await listarUsuarios().catch(() => [])
    usuarios = new Map(us.map((u) => [u.id, u.nombre]))
  }

  return lista.map((e) => {
    const datos = e.datos as { empleado_id?: string } | null
    return {
      at: e.at,
      accion: e.accion,
      entidad: e.entidad,
      quien: (e.empleado_id && nombres.get(e.empleado_id)) || 'Encargada',
      sujeto: (datos?.empleado_id && nombres.get(datos.empleado_id)) || null,
      usuario: (e.usuario_id && usuarios.get(e.usuario_id)) || null,
      datos: e.datos,
    }
  })
}

export type ParticipacionFila = {
  id: string
  empleado_id: string
  nombre: string
  desde: string
  hasta: string | null
  cantidad: number | null
  unidad: Unidad | null
  cantidad_corregida: number | null
  corregida_at: string | null
  corregida_por_nombre: string | null
}

// Tramos de las operarias en una orden, con sus nombres y el de quien corrigió.
export async function cargarParticipaciones(entidad: Entidad, id: string): Promise<ParticipacionFila[]> {
  const { data, error } = await db.from('participaciones').select('*').eq('entidad', entidad).eq('entidad_id', id).order('desde')
  if (error) throw error
  const filas = data ?? []
  if (filas.length === 0) return []
  const corrigieron = [...new Set(filas.map((f) => f.corregida_por).filter((x): x is string => !!x))]
  const [operarias, perfiles] = await Promise.all([
    db.from('v_operarias').select('empleado_id, nombre'),
    corrigieron.length ? listarUsuarios().catch(() => []) : Promise.resolve([]),
  ])
  if (operarias.error) throw operarias.error
  const nombres = new Map((operarias.data ?? []).map((o) => [o.empleado_id, o.nombre]))
  const quienes = new Map(perfiles.map((u) => [u.id, u.nombre]))
  return filas.map((f) => ({
    id: f.id,
    empleado_id: f.empleado_id,
    nombre: nombres.get(f.empleado_id) ?? 'Operaria',
    desde: f.desde,
    hasta: f.hasta,
    cantidad: f.cantidad,
    unidad: f.unidad,
    cantidad_corregida: f.cantidad_corregida,
    corregida_at: f.corregida_at,
    corregida_por_nombre: f.corregida_por ? (quienes.get(f.corregida_por) || 'Encargada') : null,
  }))
}

// MP cargadas por cada operaria en una fabricación (empleado_id → cantidad de líneas).
export async function cargarMpPorOperaria(fabricacionId: string): Promise<Map<string, number>> {
  const { data, error } = await db.from('fabricacion_mp').select('cargado_por').eq('fabricacion_id', fabricacionId)
  if (error) throw error
  const cuenta = new Map<string, number>()
  for (const f of data ?? []) if (f.cargado_por) cuenta.set(f.cargado_por, (cuenta.get(f.cargado_por) ?? 0) + 1)
  return cuenta
}

// Órdenes anteriores a las participaciones: las operarias están en la propia orden.
export async function cargarOperariasLegacy(entidad: Entidad, id: string): Promise<string[]> {
  const tabla = entidad === 'fabricacion' ? 'fabricaciones' : entidad === 'envasado' ? 'envasados' : 'fraccionados'
  const campos = entidad === 'envasado' ? 'operaria_1, operaria_2' : 'operaria_id'
  const [orden, operarias] = await Promise.all([
    db.from(tabla).select(campos).eq('id', id).maybeSingle(),
    db.from('v_operarias').select('empleado_id, nombre'),
  ])
  if (orden.error) throw orden.error
  if (operarias.error) throw operarias.error
  const fila = (orden.data ?? {}) as Record<string, string | null>
  const nombres = new Map((operarias.data ?? []).map((o) => [o.empleado_id, o.nombre]))
  return [fila.operaria_1, fila.operaria_2, fila.operaria_id].filter((x): x is string => !!x).map((x) => nombres.get(x) ?? 'Operaria')
}

// Litros que debería sumar un envasado: cantidad × litros de la presentación.
export async function cargarEsperadoEnvasado(envasadoId: string): Promise<number | null> {
  const { data, error } = await db
    .from('envasados')
    .select('cantidad, presentaciones(litros_equiv)')
    .eq('id', envasadoId)
    .maybeSingle()
  if (error) throw error
  const pres = data?.presentaciones as { litros_equiv: number } | { litros_equiv: number }[] | null | undefined
  const litros = Array.isArray(pres) ? pres[0]?.litros_equiv : pres?.litros_equiv
  return data && litros != null ? esperadoEnvasado(data.cantidad, litros) : null
}
