import type { Accion, Entidad } from '../domain/acciones'
import type { Cantidad, Unidad } from '../domain/participaciones'
import { mensajeError, type CodigoError } from './errores'
import { db } from './supabase'

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; codigo: CodigoError; texto: string }

type Respuesta = { ok?: boolean; fabricacion_cerrada?: boolean } | null

// Las RPC de produccion no lanzan errores de negocio: devuelven {ok:false, codigo, detalle}.
// Acá se unifican con los errores de PostgREST y de red en un solo formato.
async function llamar(
  nombre: 'accion' | 'cargar_mp' | 'cargar_consumible' | 'corregir_cantidad' | 'set_vencimiento' | 'registrar_control',
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

// Carga el lote de un consumible (envase, tapa, etiqueta…) de un envasado o fraccionado.
export async function guardarConsumible(id: string, lote: string, empleadoId?: string): Promise<Resultado> {
  const r = await llamar('cargar_consumible', { p_id: id, p_lote: lote, p_empleado_id: empleadoId })
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

// Registra el control de una fabricación en_control: aprobada pasa a para_envasar, rechazada vuelve a fabricando.
// Desde la tablet va con `firmante` (la liberadora elegida); desde el panel firma el usuario logueado.
export async function registrarControl(p: {
  fabricacionId: string
  ph: number | null
  densidad: number | null
  perfumeOk: boolean
  perfumeComentario: string
  visualOk: boolean
  visualComentario: string
  observaciones: string
  resultado: 'aprobado' | 'rechazado'
  firmante?: string
}): Promise<Resultado<{ intento: number }>> {
  const r = await llamar('registrar_control', {
    p_fab_id: p.fabricacionId,
    p_ph: p.ph,
    p_densidad: p.densidad,
    p_perfume_ok: p.perfumeOk,
    p_perfume_comentario: p.perfumeComentario,
    p_visual_ok: p.visualOk,
    p_visual_comentario: p.visualComentario,
    p_observaciones: p.observaciones,
    p_resultado: p.resultado,
    ...(p.firmante && { p_firmante: p.firmante }),
  })
  if (r && 'codigo' in r) return r
  return { ok: true, intento: Number((r as { intento?: number } | null)?.intento ?? 0) }
}

// Quiénes pueden firmar un control desde la tablet. Lanza si falla (el que llama muestra mensajeError).
export async function listarLiberadoras(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await db.rpc('listar_liberadoras')
  if (error) throw error
  return (data ?? []) as { id: string; nombre: string }[]
}
