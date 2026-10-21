import type { Database } from '../../lib/database.types'
import { db, supabase } from '../../lib/supabase'

export type Funcionario = Database['core']['Tables']['funcionarios']['Row']
export type OperariaConfig = { empleado_id: string; categoria: string | null; color_avatar: string | null; activo: boolean }
export type UsuarioFila = Database['produccion']['Functions']['listar_usuarios']['Returns'][number]

async function datos<T>(consulta: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await consulta
  if (error) throw error
  return data as T
}

export const listarFuncionarios = () =>
  datos<Funcionario[]>(
    supabase.schema('core').from('funcionarios').select('id, nombre, foto_url, sector, estado').neq('estado', 'baja').order('nombre'),
  )

export const listarOperarias = () =>
  datos<OperariaConfig[]>(db.from('operarias').select('empleado_id, categoria, color_avatar, activo'))

// Alta en dos pasos: la fila (grants por columna) y después el PIN (solo por RPC, nunca se lee).
// Si falla el PIN la operaria queda creada sin PIN y se puede reintentar con "Cambiar PIN".
export async function altaOperaria(
  o: { empleado_id: string; categoria: string; color_avatar: string },
  pin: string,
): Promise<{ error: unknown }> {
  const alta = await db.from('operarias').insert({ ...o, activo: true })
  if (alta.error) return { error: alta.error }
  return cambiarPin(o.empleado_id, pin)
}

export async function cambiarPin(empleadoId: string, pin: string): Promise<{ error: unknown }> {
  const { error } = await db.rpc('set_pin', { p_empleado_id: empleadoId, p_pin: pin })
  return { error }
}

export async function cambiarActiva(empleadoId: string, activo: boolean): Promise<{ error: unknown }> {
  const { error } = await db.from('operarias').update({ activo }).eq('empleado_id', empleadoId)
  return { error }
}

export const listarUsuarios = () => datos<UsuarioFila[]>(db.rpc('listar_usuarios'))

export async function setRol(usuario: string, rol: 'panel' | 'planta' | null): Promise<{ error: unknown }> {
  const { error } = await db.rpc('set_rol_usuario', { p_usuario: usuario, p_rol: rol })
  return { error }
}
