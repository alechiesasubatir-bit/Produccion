import type { NuevaFabricacion, NuevoEnvasado, NuevoFraccionado } from '../domain/ordenes'
import type { Estandar } from '../domain/kpis'
import { mensajeError } from '../lib/errores'
import { db, supabase } from '../lib/supabase'
import { cargarEstandares } from './historial/datosHistorial'

export type TanqueOrden = {
  tanque_id: string
  codigo: string
  capacidad_l: number
  estado: string
  fabricacion_id: string | null
  producto: string | null
  litros_restantes: number | null
}

export type DatosOrden = {
  tanques: TanqueOrden[]
  productos: { id: string; nombre: string; color: string }[]
  presentaciones: { id: string; nombre: string; litros_equiv: number }[]
  operarias: { empleado_id: string; nombre: string }[]
  /** Litros ya comprometidos por envasados en cola/activos/pausados, por fabricación. */
  asignados: Record<string, number>
  /** Velocidades históricas para estimar el tiempo de la orden. */
  estandares: Estandar[]
}

async function filas<T>(consulta: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}

// Catálogos activos para armar una orden (pocas filas: no hace falta paginar).
export async function cargarDatosOrden(): Promise<DatosOrden> {
  const [tanques, productos, presentaciones, operarias, abiertos, estandares] = await Promise.all([
    filas<TanqueOrden>(
      db.from('v_tanque_estado').select('tanque_id, codigo, capacidad_l, estado, fabricacion_id, producto, litros_restantes').order('orden'),
    ),
    filas<DatosOrden['productos'][number]>(db.from('productos').select('id, nombre, color').eq('activo', true).order('nombre')),
    filas<DatosOrden['presentaciones'][number]>(
      db.from('presentaciones').select('id, nombre, litros_equiv').eq('activo', true).order('nombre'),
    ),
    filas<DatosOrden['operarias'][number]>(db.from('v_operarias').select('empleado_id, nombre').order('nombre')),
    filas<{ fabricacion_id: string; cantidad: number; presentaciones: { litros_equiv: number } | null }>(
      db.from('envasados').select('fabricacion_id, cantidad, presentaciones(litros_equiv)').in('estado', ['cola', 'activo', 'pausado']),
    ),
    cargarEstandares(),
  ])
  const asignados: Record<string, number> = {}
  for (const e of abiertos) {
    asignados[e.fabricacion_id] = (asignados[e.fabricacion_id] ?? 0) + e.cantidad * (e.presentaciones?.litros_equiv ?? 0)
  }
  return { tanques, productos, presentaciones, operarias, asignados, estandares }
}

const TABLA = { fabricacion: 'fabricaciones', envasado: 'envasados', fraccionado: 'fraccionados' } as const

export async function crearOrden(
  tipo: keyof typeof TABLA,
  datos: NuevaFabricacion | NuevoEnvasado | NuevoFraccionado,
): Promise<{ error: unknown }> {
  const { error } = await db.from(TABLA[tipo]).insert(datos as never)
  return { error }
}

// Lee la hoja con la Edge Function escanear-hoja (Claude). Nunca lanza.
export async function escanearHoja(
  tipo: keyof typeof TABLA,
  imagen: string,
): Promise<{ ok: true; datos: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('escanear-hoja', { body: { tipo, imagen } })
    if (error) {
      // FunctionsHttpError trae el cuerpo de la función con el motivo.
      const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null)
      return { ok: false, error: cuerpo?.error ?? 'El servicio de lectura no respondió. Probá de nuevo o cargala a mano.' }
    }
    if (!data?.ok) return { ok: false, error: data?.error ?? 'La lectura no trajo datos válidos. Cargala a mano.' }
    return { ok: true, datos: data.datos }
  } catch (e) {
    return { ok: false, error: mensajeError(e).texto }
  }
}
