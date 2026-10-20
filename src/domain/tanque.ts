export type EstadoTanque =
  | 'libre'
  | 'cola'
  | 'fabricando'
  | 'pausada'
  | 'para_envasar'
  | 'cola_env'
  | 'envasando'
  | 'env_pausado'

function clamp01(valor: number): number {
  if (Number.isNaN(valor)) return 0
  if (valor < 0) return 0
  if (valor > 1) return 1
  return valor
}

export function nivelTanque(t: {
  estado: EstadoTanque
  capacidad: number
  litros?: number | null
  litrosRestantes?: number | null
  progresoFab?: number
}): number {
  switch (t.estado) {
    case 'fabricando':
    case 'pausada': {
      const litros = t.litros ?? 0
      const progreso = t.progresoFab ?? 0.5
      return clamp01((litros * progreso) / t.capacidad)
    }
    case 'para_envasar':
    case 'cola_env':
    case 'envasando':
    case 'env_pausado': {
      const litrosRestantes = t.litrosRestantes ?? 0
      return clamp01(litrosRestantes / t.capacidad)
    }
    case 'libre':
    case 'cola':
    default:
      return 0
  }
}

const BURBUJAS_POR_ESTADO: Partial<Record<EstadoTanque, number>> = {
  fabricando: 6,
  envasando: 2,
}

export function burbujasTanque(estado: EstadoTanque): number {
  return BURBUJAS_POR_ESTADO[estado] ?? 0
}

const ESTADOS_OLA_PAUSADA: ReadonlySet<EstadoTanque> = new Set(['pausada', 'env_pausado'])

export function olaPausada(estado: EstadoTanque): boolean {
  return ESTADOS_OLA_PAUSADA.has(estado)
}
