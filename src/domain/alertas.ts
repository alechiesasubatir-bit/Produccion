import type { Database } from '../lib/database.types'

export type Alerta = Database['produccion']['Tables']['alertas']['Row']

// Activas: sin leer y sin posponer (o con el posponer vencido). Más nuevas primero.
export function separarAlertas(alertas: Alerta[], ahora: Date) {
  const t = ahora.getTime()
  const pospuesta = (a: Alerta) => !!a.pospuesta_hasta && new Date(a.pospuesta_hasta).getTime() > t
  const porFecha = (a: Alerta, b: Alerta) => b.creada.localeCompare(a.creada)
  return {
    activas: alertas.filter((a) => !a.leida && !pospuesta(a)).sort(porFecha),
    pospuestas: alertas.filter((a) => !a.leida && pospuesta(a)).sort(porFecha),
    leidas: alertas.filter((a) => a.leida).sort(porFecha),
  }
}
