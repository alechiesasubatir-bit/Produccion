// Tipos compartidos de las operarias en una orden (migración 014).
export type Unidad = 'L' | 'kg'

// Cantidad declarada por una operaria al salir o finalizar.
export type Cantidad = { empleadoId: string; cantidad: number; unidad: Unidad }

// Operaria que está trabajando ahora en la orden (jsonb `operarias` de v_tareas / v_flujo).
export type OperariaEnOrden = { empleado_id: string; nombre: string; desde: string }

// Tramo de una operaria en la orden (jsonb `participaciones` de v_historial).
export type Participacion = OperariaEnOrden & {
  hasta: string | null
  cantidad: number | null
  unidad: Unidad | null
  cantidad_corregida: number | null
  minutos: number
}

type ConCantidad = Pick<Participacion, 'cantidad' | 'cantidad_corregida'>

// La corregida por la encargada manda sobre lo que declaró la operaria.
export function cantidadEfectiva(p: ConCantidad): number | null {
  return p.cantidad_corregida ?? p.cantidad
}

export type TotalDeclarado = {
  total: number
  /** Unidad del total; null si no hay cantidades o si se mezclan unidades. */
  unidad: Unidad | null
  /** Suma por unidad (para mostrar cada una cuando se mezclan). */
  porUnidad: Partial<Record<Unidad, number>>
  /** Tramos cerrados sin cantidad declarada ni corregida. */
  faltan: number
}

export function totalDeclarado(ps: (ConCantidad & Pick<Participacion, 'hasta' | 'unidad'>)[]): TotalDeclarado {
  const porUnidad: Partial<Record<Unidad, number>> = {}
  let total = 0
  let faltan = 0
  for (const p of ps) {
    const c = cantidadEfectiva(p)
    if (c === null) {
      if (p.hasta !== null) faltan += 1
      continue
    }
    total += c
    const u: Unidad = p.unidad ?? 'L'
    porUnidad[u] = (porUnidad[u] ?? 0) + c
  }
  const unidades = Object.keys(porUnidad) as Unidad[]
  return { total, unidad: unidades.length === 1 ? unidades[0] : null, porUnidad, faltan }
}

// Litros que deberían salir de un envasado: cantidad de unidades × litros de la presentación.
export function esperadoEnvasado(cantidad: number, litrosPresentacion: number): number {
  return cantidad * litrosPresentacion
}
