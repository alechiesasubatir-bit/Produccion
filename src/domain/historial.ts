import type { Database } from '../lib/database.types'
import type { Entidad } from './acciones'

export type FilaHistorial = Database['produccion']['Views']['v_historial']['Row']
/** Fechas YYYY-MM-DD, inclusivas. */
export type Rango = { desde: string; hasta: string }

export const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function filtrarHistorial(
  filas: FilaHistorial[],
  f: { entidad?: Entidad | ''; estado?: string; texto?: string },
): FilaHistorial[] {
  const texto = normalizar((f.texto ?? '').trim())
  return filas.filter((r) => {
    if (f.entidad && r.entidad !== f.entidad) return false
    if (f.estado && r.estado !== f.estado) return false
    if (!texto) return true
    const campos = [r.producto, r.lote, r.tanque_codigo, r.presentacion, r.operaria_1_nombre, r.operaria_2_nombre, r.descripcion]
    return campos.some((c) => c && normalizar(c).includes(texto))
  })
}

// Orden por cualquier columna; los vacíos siempre al final.
export function ordenarHistorial(filas: FilaHistorial[], por: keyof FilaHistorial, asc: boolean): FilaHistorial[] {
  return [...filas].sort((a, b) => {
    const x = a[por]
    const y = b[por]
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1
    if (y === null || y === undefined) return -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })
    return asc ? c : -c
  })
}

export function porDia(filas: FilaHistorial[]): Map<string, FilaHistorial[]> {
  const m = new Map<string, FilaHistorial[]>()
  for (const f of filas) {
    const l = m.get(f.dia)
    if (l) l.push(f)
    else m.set(f.dia, [f])
  }
  return m
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Días de la grilla mensual (mes 1-12): de lunes a domingo, con relleno de los meses vecinos. */
export function diasDelMes(anio: number, mes: number): string[] {
  const primero = new Date(Date.UTC(anio, mes - 1, 1))
  const ultimo = new Date(Date.UTC(anio, mes, 0))
  const desde = new Date(primero)
  desde.setUTCDate(1 - ((primero.getUTCDay() + 6) % 7))
  const hasta = new Date(ultimo)
  hasta.setUTCDate(ultimo.getUTCDate() + (6 - ((ultimo.getUTCDay() + 6) % 7)))
  const dias: string[] = []
  for (const d = new Date(desde); d <= hasta; d.setUTCDate(d.getUTCDate() + 1)) dias.push(iso(d))
  return dias
}

const fecha = (s: string) => new Date(`${s}T00:00:00Z`)
const sumarDias = (s: string, n: number) => {
  const d = fecha(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const lunesDe = (s: string) => sumarDias(s, -((fecha(s).getUTCDay() + 6) % 7))
const mesDe = (anio: number, mes0: number): Rango => ({
  desde: iso(new Date(Date.UTC(anio, mes0, 1))),
  hasta: iso(new Date(Date.UTC(anio, mes0 + 1, 0))),
})

/** Fecha de hoy en Montevideo (YYYY-MM-DD). */
export function hoyMontevideo(ahora = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' })
}

export type Atajo = 'hoy' | 'semana' | 'mes' | 'mesAnterior'

export function rangoDe(atajo: Atajo, hoy: string): Rango {
  const d = fecha(hoy)
  if (atajo === 'hoy') return { desde: hoy, hasta: hoy }
  if (atajo === 'semana') return { desde: lunesDe(hoy), hasta: sumarDias(lunesDe(hoy), 6) }
  if (atajo === 'mes') return mesDe(d.getUTCFullYear(), d.getUTCMonth())
  return mesDe(d.getUTCFullYear(), d.getUTCMonth() - 1)
}

/** Mes o semana completos que contienen `desde`, corridos `n` períodos. */
export function moverRango(r: Rango, periodo: 'mes' | 'semana', n: number): Rango {
  const d = fecha(r.desde)
  if (periodo === 'mes') return mesDe(d.getUTCFullYear(), d.getUTCMonth() + n)
  const lunes = sumarDias(lunesDe(r.desde), 7 * n)
  return { desde: lunes, hasta: sumarDias(lunes, 6) }
}
