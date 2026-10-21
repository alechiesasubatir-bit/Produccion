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
