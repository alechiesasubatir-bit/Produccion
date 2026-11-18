import type { Entidad } from './acciones'
import type { FilaFlujo } from './flujo'
import type { Cantidad, Unidad } from './participaciones'

export type RefOrden = { entidad: Entidad; id: string }
/** `motivo`: obligatorio cuando la cantidad es 0 (la operaria no llegó a hacer nada). */
export type CantidadOrden = RefOrden & Cantidad & { motivo?: string }
export type OrdenArranque = RefOrden & { empleados: string[] }
export type PausaAbierta = { id: string; inicio: string }

export type EstadoArranque = {
  ref: RefOrden
  orden: FilaFlujo | null
  /** La orden ya no está pausada (la cerraron o la reanudaron durante la noche). */
  cerrada: boolean
  reanudar: boolean
  empleados: string[]
}

const EN_MARCHA = new Set(['fabricando', 'pausada', 'activo', 'pausado'])
const ORDEN_ENTIDAD: Record<string, number> = { fabricacion: 0, envasado: 1, fraccionado: 2 }

export function ordenesEnMarcha(flujo: FilaFlujo[]): FilaFlujo[] {
  return flujo
    .filter((f) => EN_MARCHA.has(f.estado))
    .sort(
      (a, b) =>
        (ORDEN_ENTIDAD[a.entidad] ?? 9) - (ORDEN_ENTIDAD[b.entidad] ?? 9) ||
        (a.producto ?? '').localeCompare(b.producto ?? ''),
    )
}

export function pideCantidad(o: FilaFlujo): boolean {
  return o.entidad === 'envasado' || o.entidad === 'fraccionado'
}

export function unidadPorDefecto(o: FilaFlujo): Unidad {
  return o.producto_tipo === 'polvo' ? 'kg' : 'L'
}

// Órdenes que piden cantidad y donde alguna operaria todavía no la declaró.
export function faltanCantidades(ordenes: FilaFlujo[], cantidades: CantidadOrden[]): RefOrden[] {
  return ordenes
    .filter(pideCantidad)
    .filter((o) =>
      o.operarias.some(
        (op) => !cantidades.some((c) => c.entidad === o.entidad && c.id === o.id && c.empleadoId === op.empleado_id),
      ),
    )
    .map((o) => ({ entidad: o.entidad, id: o.id }))
}

// `activas`: ids de las operarias activas (v_operarias). Las de anoche que ya no están activas no se
// premarcan: el Arranque las rechazaría con OPERARIA_INACTIVA.
export function armarArranque(
  filas: { entidad: Entidad; entidad_id: string; estaba: 'en_curso' | 'pausada'; operarias: string[] }[],
  flujo: FilaFlujo[],
  activas: ReadonlySet<string>,
): EstadoArranque[] {
  return filas.map((f) => {
    const orden = flujo.find((o) => o.entidad === f.entidad && o.id === f.entidad_id) ?? null
    const cerrada = !orden || (orden.estado !== 'pausada' && orden.estado !== 'pausado')
    return {
      ref: { entidad: f.entidad, id: f.entidad_id },
      orden,
      cerrada,
      reanudar: f.estaba === 'en_curso' && !cerrada,
      empleados: f.operarias.filter((id) => activas.has(id)),
    }
  })
}

// Errores por orden (clave `${entidad}:${id}`) de las que se van a reanudar.
export function erroresArranque(e: EstadoArranque[], nombres: Map<string, string>): Record<string, string> {
  const errores: Record<string, string> = {}
  const marcadas = e.filter((x) => x.reanudar && !x.cerrada)
  const clave = (x: EstadoArranque) => `${x.ref.entidad}:${x.ref.id}`
  for (const x of marcadas) {
    if (x.empleados.length === 0) errores[clave(x)] = 'Elegí al menos una operaria.'
  }
  const envasados = marcadas.filter((x) => x.ref.entidad === 'envasado')
  const veces = new Map<string, number>()
  for (const x of envasados) for (const id of new Set(x.empleados)) veces.set(id, (veces.get(id) ?? 0) + 1)
  for (const x of envasados) {
    const repetida = x.empleados.find((id) => (veces.get(id) ?? 0) > 1)
    if (repetida && !errores[clave(x)]) {
      errores[clave(x)] = `${nombres.get(repetida) ?? 'Una operaria'} ya está en otro envasado.`
    }
  }
  return errores
}
