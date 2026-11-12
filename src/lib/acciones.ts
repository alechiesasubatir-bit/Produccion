import type { Accion, Entidad } from '../domain/acciones'
import type { Cantidad, Unidad } from '../domain/participaciones'
import { mensajeError, type CodigoError } from './errores'
import { db } from './supabase'

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; codigo: CodigoError; texto: string }

type Respuesta = { ok?: boolean; fabricacion_cerrada?: boolean } | null

// Las RPC de produccion no lanzan errores de negocio: devuelven {ok:false, codigo, detalle}.
// Acá se unifican con los errores de PostgREST y de red en un solo formato.
async function llamar(
  nombre: 'accion' | 'cargar_mp' | 'corregir_cantidad' | 'set_vencimiento',
  args: Record<string, unknown>,
): Promise<Respuesta | Resultado> {
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

export async function ejecutarAccion(p: {
  entidad: Entidad
  id: string
  accion: Accion
  empleadoId: string
  cantidades?: Cantidad[]
}): Promise<Resultado<{ fabricacionCerrada: boolean }>> {
  const r = await llamar('accion', {
    p_entidad: p.entidad,
    p_id: p.id,
    p_accion: p.accion,
    p_empleado_id: p.empleadoId,
    ...(p.cantidades && {
      p_cantidades: p.cantidades.map((c) => ({ empleado_id: c.empleadoId, cantidad: c.cantidad, unidad: c.unidad })),
    }),
  })
  if (r && 'codigo' in r) return r
  return { ok: true, fabricacionCerrada: !!(r as Respuesta)?.fabricacion_cerrada }
}

// Carga lote/pesado de una MP de la fórmula (tablet con la operaria elegida, o el panel).
export async function guardarMp(p: {
  id: string
  lote: string
  pesado: boolean
  empleadoId?: string
}): Promise<Resultado> {
  const r = await llamar('cargar_mp', {
    p_mp_id: p.id,
    p_lote: p.lote,
    p_pesado: p.pesado,
    p_empleado_id: p.empleadoId,
  })
  return r && 'codigo' in r ? r : { ok: true }
}

// Acción de la encargada: el panel acciona sin operaria (accion() lo permite a es_panel()).
export async function accionPanel(p: {
  entidad: Entidad
  id: string
  accion: Accion
}): Promise<Resultado<{ fabricacionCerrada: boolean }>> {
  const r = await llamar('accion', { p_entidad: p.entidad, p_id: p.id, p_accion: p.accion })
  if (r && 'codigo' in r) return r
  return { ok: true, fabricacionCerrada: !!(r as Respuesta)?.fabricacion_cerrada }
}

// Corrige la cantidad declarada por una operaria (solo el panel).
export async function corregirCantidad(p: {
  participacionId: string
  cantidad: number
  unidad?: Unidad
}): Promise<Resultado> {
  const r = await llamar('corregir_cantidad', {
    p_participacion_id: p.participacionId,
    p_cantidad: p.cantidad,
    p_unidad: p.unidad,
  })
  return r && 'codigo' in r ? r : { ok: true }
}

// Carga o corrige el vencimiento de una fabricación (tablet con operaria, o el panel).
export async function setVencimiento(p: {
  fabricacionId: string
  fecha: string
  empleadoId?: string
}): Promise<Resultado> {
  const r = await llamar('set_vencimiento', {
    p_fab_id: p.fabricacionId,
    p_fecha: p.fecha,
    p_empleado_id: p.empleadoId,
  })
  return r && 'codigo' in r ? r : { ok: true }
}
