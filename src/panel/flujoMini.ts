import type { FilaFlujo } from '../domain/flujo'
import { nivelTanque, type EstadoTanque } from '../domain/tanque'

// Lo que comparten la tarjeta del flujo y su detalle.

export function estadoMini(f: FilaFlujo): EstadoTanque {
  if (f.entidad === 'fabricacion') return f.estado === 'finalizada' ? 'libre' : (f.estado as EstadoTanque)
  if (f.estado === 'activo') return 'envasando'
  if (f.estado === 'pausado') return 'env_pausado'
  return 'cola_env'
}

// Nivel aproximado: lo que queda de la fabricación sobre lo fabricado.
export const nivelMini = (f: FilaFlujo) =>
  nivelTanque({
    estado: estadoMini(f),
    capacidad: f.litros ?? 1,
    litros: f.litros ?? 1,
    litrosRestantes: f.litros_restantes ?? f.litros ?? 1,
    progresoFab: 0.6,
  })

// Sin participaciones (órdenes anteriores) se usan las operarias guardadas en la propia orden.
export function nombresOperarias(f: FilaFlujo, nombres: Map<string, string>): string[] {
  const enOrden = (f.operarias ?? []).map((o) => o.nombre)
  return enOrden.length
    ? enOrden
    : [f.operaria_1, f.operaria_2].filter((id): id is string => !!id).map((id) => nombres.get(id) ?? 'Operaria')
}
