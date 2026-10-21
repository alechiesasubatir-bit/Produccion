import { db } from '../lib/supabase'

export type EventoRecorrido = { at: string; accion: string; quien: string; entidad: string }

// Eventos de una fabricación y de sus envasados, con el nombre de quién los hizo.
export async function cargarRecorrido(fabricacionId: string): Promise<EventoRecorrido[]> {
  const envasados = await db.from('envasados').select('id').eq('fabricacion_id', fabricacionId)
  if (envasados.error) throw envasados.error
  const ids = [fabricacionId, ...(envasados.data ?? []).map((e) => e.id)]

  const [eventos, operarias] = await Promise.all([
    db.from('eventos').select('at, accion, empleado_id, entidad').in('entidad_id', ids).order('at'),
    db.from('v_operarias').select('empleado_id, nombre'),
  ])
  if (eventos.error) throw eventos.error
  const nombres = new Map((operarias.data ?? []).map((o) => [o.empleado_id, o.nombre]))

  return (eventos.data ?? []).map((e) => ({
    at: e.at,
    accion: e.accion,
    entidad: e.entidad,
    quien: (e.empleado_id && nombres.get(e.empleado_id)) || 'Encargada',
  }))
}
