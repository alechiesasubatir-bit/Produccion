import { db } from '../../lib/supabase'

export type TablaCatalogo = 'productos' | 'presentaciones' | 'tanques'
export type FilaCatalogo = { id: string; activo: boolean } & Record<string, unknown>

// Catálogos chicos (decenas de filas): sin paginar. Incluye inactivos para poder reactivarlos.
export async function listar(tabla: TablaCatalogo): Promise<FilaCatalogo[]> {
  const { data, error } = await db.from(tabla).select('*')
  if (error) throw error
  return (data ?? []) as FilaCatalogo[]
}

export async function insertar(tabla: TablaCatalogo, datos: Record<string, unknown>): Promise<{ error: unknown }> {
  const { error } = await db.from(tabla).insert(datos as never)
  return { error }
}

export async function actualizar(tabla: TablaCatalogo, id: string, datos: Record<string, unknown>): Promise<{ error: unknown }> {
  const { error } = await db.from(tabla).update(datos as never).eq('id', id)
  return { error }
}
