import { db } from './supabase'

export type FilaMp = {
  id: string
  orden: number
  codigo: string
  descripcion: string
  cantidad: number
  lote: string | null
  pesado: boolean
  cargado_por: string | null
  cargado_at: string | null
}

// Checklist de materias primas de una fabricación, en el orden de la fórmula.
export async function cargarMpDe(fabricacionId: string): Promise<FilaMp[]> {
  const { data, error } = await db
    .from('fabricacion_mp')
    .select('id, orden, codigo, descripcion, cantidad, lote, pesado, cargado_por, cargado_at')
    .eq('fabricacion_id', fabricacionId)
    .order('orden')
  if (error) throw error
  return data ?? []
}
