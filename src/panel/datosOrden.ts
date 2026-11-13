import type { Database } from '../lib/database.types'
import type { MpFormula } from '../domain/formulaPdf'
import type { Consumible } from '../domain/envasadoPdf'
import type {
  NuevaFabricacion,
  NuevaFabricacionFormula,
  NuevoEnvasado,
  NuevoEnvasadoDocumento,
  NuevoFraccionado,
  NuevoFraccionadoDocumento,
} from '../domain/ordenes'
import type { Estandar } from '../domain/kpis'
import type { Resultado } from '../lib/acciones'
import { mensajeError } from '../lib/errores'
import { db, fetchAll } from '../lib/supabase'
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
  /** Fabricaciones que todavía pueden recibir un envasado, con los litros aún sin asignar. */
  fabricacionesAbiertas: { id: string; producto_id: string; tanque_id: string; lote: string | null; litros: number; sinAsignar: number }[]
}

async function filas<T>(consulta: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}

const ABIERTAS: Database['produccion']['Tables']['fabricaciones']['Row']['estado'][] = ['cola', 'fabricando', 'pausada', 'en_control', 'para_envasar']

// Lotes de envasados o fraccionados ya cargados entre los del PDF (para no duplicar un documento): consulta
// puntual, sin leer toda la tabla. Cada pestaña mira solo lo suyo.
export async function cargarLotesDocumento(tipo: 'envasado' | 'fraccionado', lotes: string[]): Promise<Set<string>> {
  if (lotes.length === 0) return new Set()
  const filasLote = await filas<{ lote: string | null }>(
    db
      .from(tipo === 'envasado' ? 'envasados' : 'fraccionados')
      .select('lote')
      .in('lote', lotes)
      .neq('estado', 'cancelado'),
  )
  return new Set(filasLote.map((f) => (f.lote ?? '').trim()).filter(Boolean))
}

// Catálogos activos para armar una orden (pocas filas: no hace falta paginar) y lo que crece con el
// tiempo, consultado con filtro o paginado (PostgREST corta en 1000 filas).
export async function cargarDatosOrden(): Promise<DatosOrden> {
  const [tanques, productos, presentaciones, etiquetas, operarias, abiertos, estandares, fabs, lotesFabs] = await Promise.all([
    filas<TanqueOrden>(
      db.from('v_tanque_estado').select('tanque_id, codigo, capacidad_l, estado, fabricacion_id, producto, litros_restantes').order('orden'),
    ),
    filas<DatosOrden['productos'][number]>(db.from('productos').select('id, nombre, color, codigo').eq('activo', true).order('nombre')),
    filas<DatosOrden['presentaciones'][number]>(
      db.from('presentaciones').select('id, nombre, litros_equiv').eq('activo', true).order('nombre'),
    ),
    filas<DatosOrden['etiquetas'][number]>(db.from('etiquetas').select('id, nombre').eq('activo', true).order('nombre')),
    filas<DatosOrden['operarias'][number]>(db.from('v_operarias').select('empleado_id, nombre').order('nombre')),
    filas<{ fabricacion_id: string | null; cantidad: number; presentaciones: { litros_equiv: number } | null }>(
      db.from('envasados').select('fabricacion_id, cantidad, presentaciones(litros_equiv)').in('estado', ['cola', 'activo', 'pausado']),
    ),
    cargarEstandares(),
    filas<{ id: string; lote: string | null; producto_id: string; tanque_id: string; litros: number; estado: string }>(
      db.from('fabricaciones').select('id, lote, producto_id, tanque_id, litros, estado').in('estado', ABIERTAS),
    ),
    fetchAll<{ lote: string | null }>((from, to) =>
      db.from('fabricaciones').select('lote').not('lote', 'is', null).neq('estado', 'cancelada').order('id').range(from, to),
    ),
  ])
  const asignados: Record<string, number> = {}
  for (const e of abiertos) {
    if (!e.fabricacion_id) continue
    asignados[e.fabricacion_id] = (asignados[e.fabricacion_id] ?? 0) + e.cantidad * (e.presentaciones?.litros_equiv ?? 0)
  }
  const lotesAbiertos = [...new Set(lotesFabs.map((f) => (f.lote ?? '').trim()).filter(Boolean))]
  const fabricacionesAbiertas = fabs
    .map((f) => ({
      id: f.id,
      producto_id: f.producto_id,
      tanque_id: f.tanque_id,
      lote: f.lote,
      litros: f.litros,
      sinAsignar: Math.max(0, f.litros - (asignados[f.id] ?? 0)),
    }))
  return { tanques, productos, presentaciones, etiquetas, operarias, asignados, estandares, lotesAbiertos, fabricacionesAbiertas }
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

// Llama a una RPC que devuelve {ok, id?} / {ok:false, codigo, detalle}. Nunca lanza.
async function rpcConId(
  nombre: 'crear_envasado_documento' | 'crear_fraccionado_documento' | 'crear_granel_stock',
  args: object,
): Promise<Resultado<{ id: string }>> {
  try {
    const { data, error } = await db.rpc(nombre, args as never)
    if (error) return { ok: false, ...mensajeError(error) }
    const r = data as { ok?: boolean; id?: string } | null
    if (!r?.ok) return { ok: false, ...mensajeError(r) }
    return { ok: true, id: r.id as string }
  } catch (e) {
    return { ok: false, ...mensajeError(e) }
  }
}

// Envasado desde la hoja del PDF (con o sin tanque) y sus consumibles, en una transacción.
export function crearEnvasadoDocumento(env: NuevoEnvasadoDocumento, consumibles: Consumible[]): Promise<Resultado<{ id: string }>> {
  return rpcConId('crear_envasado_documento', { p_env: env, p_consumibles: consumibles })
}

export function crearFraccionadoDocumento(frac: NuevoFraccionadoDocumento, consumibles: Consumible[]): Promise<Resultado<{ id: string }>> {
  return rpcConId('crear_fraccionado_documento', { p_frac: frac, p_consumibles: consumibles })
}

// Granel que no se fabricó en la app: deja el tanque en para_envasar.
export function crearGranelStock(d: { tanque_id: string; producto_id: string; litros: number; lote: string | null }): Promise<Resultado<{ id: string }>> {
  return rpcConId('crear_granel_stock', { p_tanque_id: d.tanque_id, p_producto_id: d.producto_id, p_litros: d.litros, p_lote: d.lote })
}

// Edición directa de un envasado (grants de columna). El trigger rechaza con NO_EDITABLE,
// TANQUE_EN_USO, TRANSICION_INVALIDA, GRANEL_DISTINTO o SIN_TANQUE; mensajeError los traduce.
export async function editarEnvasado(
  id: string,
  cambios: Partial<{ cantidad: number; presentacion_id: string; fabricacion_id: string }>,
): Promise<Resultado> {
  try {
    const { error } = await db.from('envasados').update(cambios as never).eq('id', id)
    if (error) return { ok: false, ...mensajeError(error) }
    return { ok: true }
  } catch (e) {
    return { ok: false, ...mensajeError(e) }
  }
}

export type EnvasadoEditable = {
  cantidad: number
  presentacion_id: string
  estado: string
  fabricacion_id: string | null
  granel_id: string | null
}

// Valores actuales de un envasado para precargar el diálogo de edición.
export async function cargarEnvasadoEdicion(id: string): Promise<EnvasadoEditable | null> {
  const { data, error } = await db
    .from('envasados')
    .select('cantidad, presentacion_id, estado, fabricacion_id, granel_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as EnvasadoEditable | null
}
