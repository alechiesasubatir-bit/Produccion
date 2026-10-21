import type { FilaHistorial, Rango } from '../../domain/historial'
import type { Estandar } from '../../domain/kpis'
import { db, fetchAll } from '../../lib/supabase'

// Paginado: un rango largo puede traer más de 1000 tareas (límite de PostgREST).
export function cargarHistorial(r: Rango): Promise<FilaHistorial[]> {
  return fetchAll<FilaHistorial>((from, to) =>
    db
      .from('v_historial')
      .select('*')
      .gte('dia', r.desde)
      .lte('dia', r.hasta)
      .order('dia', { ascending: false })
      .order('id')
      .range(from, to),
  )
}

export async function cargarEstandares(): Promise<Estandar[]> {
  const { data, error } = await db.from('v_tiempos_estandar').select('*')
  if (error) throw error
  return data ?? []
}
