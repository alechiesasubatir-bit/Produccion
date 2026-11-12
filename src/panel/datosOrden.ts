import type { MpFormula } from '../domain/formulaPdf'
import type { NuevaFabricacion, NuevaFabricacionFormula, NuevoEnvasado, NuevoFraccionado } from '../domain/ordenes'
import type { Estandar } from '../domain/kpis'
import type { Resultado } from '../lib/acciones'
import { mensajeError } from '../lib/errores'
import { db } from '../lib/supabase'
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
  productos: { id: string; nombre: string; color: string; codigo: string | null }[]
  presentaciones: { id: string; nombre: string; litros_equiv: number }[]
  etiquetas: { id: string; nombre: string }[]
  operarias: { empleado_id: string; nombre: string }[]
  /** Litros ya comprometidos por envasados en cola/activos/pausados, por fabricación. */
  asignados: Record<string, number>
  /** Velocidades históricas para estimar el tiempo de la orden. */
  estandares: Estandar[]
  /** Lotes de fabricaciones no canceladas (para no crear dos veces la misma fórmula). */
  lotesAbiertos: string[]
}

async function filas<T>(consulta: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}

// Catálogos activos para armar una orden (pocas filas: no hace falta paginar).
export async function cargarDatosOrden(): Promise<DatosOrden> {
  const [tanques, productos, presentaciones, etiquetas, operarias, abiertos, estandares, lotes] = await Promise.all([
    filas<TanqueOrden>(
      db.from('v_tanque_estado').select('tanque_id, codigo, capacidad_l, estado, fabricacion_id, producto, litros_restantes').order('orden'),
    ),
    filas<DatosOrden['productos'][number]>(db.from('productos').select('id, nombre, color, codigo').eq('activo', true).order('nombre')),
    filas<DatosOrden['presentaciones'][number]>(
      db.from('presentaciones').select('id, nombre, litros_equiv').eq('activo', true).order('nombre'),
    ),
    filas<DatosOrden['etiquetas'][number]>(db.from('etiquetas').select('id, nombre').eq('activo', true).order('nombre')),
    filas<DatosOrden['operarias'][number]>(db.from('v_operarias').select('empleado_id, nombre').order('nombre')),
    filas<{ fabricacion_id: string; cantidad: number; presentaciones: { litros_equiv: number } | null }>(
      db.from('envasados').select('fabricacion_id, cantidad, presentaciones(litros_equiv)').in('estado', ['cola', 'activo', 'pausado']),
    ),
    cargarEstandares(),
    filas<{ lote: string | null }>(db.from('fabricaciones').select('lote').neq('estado', 'cancelada')),
  ])
  const asignados: Record<string, number> = {}
  for (const e of abiertos) {
    asignados[e.fabricacion_id] = (asignados[e.fabricacion_id] ?? 0) + e.cantidad * (e.presentaciones?.litros_equiv ?? 0)
  }
  const lotesAbiertos = [...new Set(lotes.map((f) => (f.lote ?? '').trim()).filter(Boolean))]
  return { tanques, productos, presentaciones, etiquetas, operarias, asignados, estandares, lotesAbiertos }
}

const TABLA = { fabricacion: 'fabricaciones', envasado: 'envasados', fraccionado: 'fraccionados' } as const

export async function crearOrden(
  tipo: keyof typeof TABLA,
  datos: NuevaFabricacion | Omit<NuevoEnvasado, 'etiquetar'> | Omit<NuevoFraccionado, 'etiquetar'>,
): Promise<{ error: unknown }> {
  const { error } = await db.from(TABLA[tipo]).insert(datos as never)
  return { error }
}

// Crea una fabricación con su checklist de MP a partir de una fórmula leída del PDF. Nunca lanza:
// la RPC produccion.crear_fabricacion_formula() devuelve {ok:false, codigo, detalle} en negocio.
export async function crearFabricacionFormula(fab: NuevaFabricacionFormula, mp: MpFormula[]): Promise<Resultado<{ id: string }>> {
  try {
    const { data, error } = await db.rpc('crear_fabricacion_formula', {
      p_fab: {
        tanque_id: fab.tanque_id,
        producto_id: fab.producto_id,
        litros: fab.litros,
        lote: fab.lote,
        vencimiento: fab.vencimiento,
        fecha_formula: fab.fecha_formula,
        operaria_id: fab.operaria_id,
        codigo_producto: fab.codigo_producto,
      },
      p_mp: mp,
    } as never)
    if (error) return { ok: false, ...mensajeError(error) }
    const r = data as { ok?: boolean; id?: string } | null
    if (!r?.ok) return { ok: false, ...mensajeError(r) }
    return { ok: true, id: r.id as string }
  } catch (e) {
    return { ok: false, ...mensajeError(e) }
  }
}
