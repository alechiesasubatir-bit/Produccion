import { db } from './supabase'

export type FilaConsumible = {
  id: string
  orden: number
  codigo: string
  descripcion: string
  cantidad: number
  lote: string | null
  cargado_por: string | null
  cargado_at: string | null
}

// Consumibles de un envasado o fraccionado, en el orden del documento.
export async function cargarConsumiblesDe(entidad: 'envasado' | 'fraccionado', id: string): Promise<FilaConsumible[]> {
  const { data, error } = await db
    .from('consumibles')
    .select('id, orden, codigo, descripcion, cantidad, lote, cargado_por, cargado_at')
    .eq('entidad', entidad)
    .eq('entidad_id', id)
    .order('orden')
  if (error) throw error
  return data ?? []
}
