import type { FilaFlujo } from '../domain/flujo'
import { db, fetchAll } from '../lib/supabase'

export type OperariaNombre = { empleado_id: string; nombre: string }

export const cargarFlujo = () =>
  fetchAll<FilaFlujo>((from, to) => db.from('v_flujo').select('*').order('created_at').range(from, to))
export const cargarOperarias = () =>
  fetchAll<OperariaNombre>((from, to) => db.from('v_operarias').select('empleado_id, nombre').range(from, to))
