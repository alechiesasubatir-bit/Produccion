// Tiempo estimado a partir de la velocidad histórica (v_tiempos_estandar), como calcProyFab/Env
// de la app vieja pero con tiempos efectivos.
type Velocidad = { velocidad: number } | null | undefined

function proyeccion(cantidad: number, std: Velocidad): number | null {
  if (!std || !(std.velocidad > 0) || !(cantidad > 0)) return null
  return Math.round(cantidad / std.velocidad)
}

export const proyeccionFabricacion = (litros: number, std: Velocidad) => proyeccion(litros, std)
export const proyeccionEnvasado = (cantidad: number, std: Velocidad) => proyeccion(cantidad, std)

export function textoProyeccion(minutos: number, velocidad: number, unidad: 'L' | 'u'): string {
  const v = velocidad.toLocaleString('es-UY', { maximumFractionDigits: 1 })
  return `~${Math.max(1, Math.round(minutos))} min (histórico ${v} ${unidad}/min)`
}
