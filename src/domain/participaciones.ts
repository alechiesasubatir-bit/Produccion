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
