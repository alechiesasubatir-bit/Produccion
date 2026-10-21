import type { Alerta } from '../../domain/alertas'
import { db, fetchAll } from '../../lib/supabase'

export const cargarAlertas = () =>
  fetchAll<Alerta>((from, to) => db.from('alertas').select('*').order('creada', { ascending: false }).range(from, to))

export async function marcarLeida(id: string): Promise<{ error: unknown }> {
  const { error } = await db.from('alertas').update({ leida: true }).eq('id', id)
  return { error }
}

export async function posponerAlerta(id: string, hasta: string): Promise<{ error: unknown }> {
  const { error } = await db.from('alertas').update({ pospuesta_hasta: hasta }).eq('id', id)
  return { error }
}
