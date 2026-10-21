import type { Accion, Entidad } from '../domain/acciones'
import { mensajeError, type CodigoError } from './errores'
import { db } from './supabase'

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; codigo: CodigoError; texto: string }

type Respuesta = { ok?: boolean; fabricacion_cerrada?: boolean } | null

// Las RPC de produccion no lanzan errores de negocio: devuelven {ok:false, codigo, detalle}.
// Acá se unifican con los errores de PostgREST y de red en un solo formato.
async function llamar(nombre: 'accion' | 'verificar_pin', args: Record<string, string>): Promise<Respuesta | Resultado> {
  try {
    const { data, error } = await db.rpc(nombre, args as never)
    if (error) return { ok: false, ...mensajeError(error) }
    const r = data as Respuesta
    if (!r?.ok) return { ok: false, ...mensajeError(r) }
    return r
  } catch (e) {
    return { ok: false, ...mensajeError(e) }
  }
}

export async function verificarPin(empleadoId: string, pin: string): Promise<Resultado> {
  const r = await llamar('verificar_pin', { p_empleado_id: empleadoId, p_pin: pin })
  return r && 'codigo' in r ? r : { ok: true }
}

export async function ejecutarAccion(p: {
  entidad: Entidad
  id: string
  accion: Accion
  empleadoId: string
  pin: string
}): Promise<Resultado<{ fabricacionCerrada: boolean }>> {
  const r = await llamar('accion', {
    p_entidad: p.entidad,
    p_id: p.id,
    p_accion: p.accion,
    p_empleado_id: p.empleadoId,
    p_pin: p.pin,
  })
  if (r && 'codigo' in r) return r
  return { ok: true, fabricacionCerrada: !!(r as Respuesta)?.fabricacion_cerrada }
}
