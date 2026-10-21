import type { NuevaFabricacion, NuevoEnvasado, NuevoFraccionado } from '../domain/ordenes'
import { db } from '../lib/supabase'

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
}

async function filas<T>(consulta: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}

// Catálogos activos para armar una orden (pocas filas: no hace falta paginar).
export async function cargarDatosOrden(): Promise<DatosOrden> {
  const [tanques, productos, presentaciones, operarias] = await Promise.all([
    filas<TanqueOrden>(
      db.from('v_tanque_estado').select('tanque_id, codigo, capacidad_l, estado, fabricacion_id, producto, litros_restantes').order('orden'),
    ),
    filas<DatosOrden['productos'][number]>(db.from('productos').select('id, nombre, color').eq('activo', true).order('nombre')),
    filas<DatosOrden['presentaciones'][number]>(
      db.from('presentaciones').select('id, nombre, litros_equiv').eq('activo', true).order('nombre'),
    ),
    filas<DatosOrden['operarias'][number]>(db.from('v_operarias').select('empleado_id, nombre').order('nombre')),
  ])
  return { tanques, productos, presentaciones, operarias }
}

const TABLA = { fabricacion: 'fabricaciones', envasado: 'envasados', fraccionado: 'fraccionados' } as const

export async function crearOrden(
  tipo: keyof typeof TABLA,
  datos: NuevaFabricacion | NuevoEnvasado | NuevoFraccionado,
): Promise<{ error: unknown }> {
  const { error } = await db.from(TABLA[tipo]).insert(datos as never)
  return { error }
}
