import type { PausaAbierta } from '../domain/pausaGeneral'
import type { Database } from '../lib/database.types'
import { db } from '../lib/supabase'
import { useRealtime } from '../lib/useRealtime'

export type FilaPausaOrden = Database['produccion']['Tables']['pausa_general_ordenes']['Row']

// La pausa general abierta (a lo sumo una: índice único sobre fin is null).
export async function cargarPausaAbierta(): Promise<PausaAbierta | null> {
  const { data, error } = await db
    .from('pausas_generales')
    .select('id, inicio')
    .is('fin', null)
    .order('inicio', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

// Las órdenes que congeló la pausa, con cómo estaban y sus operarias.
export async function cargarOrdenesPausa(pausaId: string): Promise<FilaPausaOrden[]> {
  const { data, error } = await db.from('pausa_general_ordenes').select('*').eq('pausa_id', pausaId)
  if (error) throw error
  return data ?? []
}

const cargarComoLista = async () => {
  const p = await cargarPausaAbierta()
  return p ? [p] : []
}

// Pausa general abierta, en tiempo real, con `recargar` para ponerse al día tras una acción propia
// sin esperar al canal (si cayó, el polling tarda 15 s).
export function usePausaGeneralEnVivo(): { pausa: PausaAbierta | null; recargar: () => void } {
  const { datos, recargar } = useRealtime<PausaAbierta>('pausas_generales', cargarComoLista, ['pausas_generales'])
  return { pausa: datos[0] ?? null, recargar }
}

// Pausa general abierta, en tiempo real (panel, Monitor y tablet).
export function usePausaGeneral(): PausaAbierta | null {
  return usePausaGeneralEnVivo().pausa
}
