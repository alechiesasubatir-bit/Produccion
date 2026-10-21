import type { Database } from '../lib/database.types'

export type FilaFlujo = Database['produccion']['Views']['v_flujo']['Row']

export type Columna = 'cola' | 'fabricando' | 'para_envasar' | 'envasando' | 'fraccionado' | 'terminadas'

export const COLUMNAS: { id: Columna; titulo: string }[] = [
  { id: 'cola', titulo: 'Cola' },
  { id: 'fabricando', titulo: 'Fabricando' },
  { id: 'para_envasar', titulo: 'Para envasar' },
  { id: 'envasando', titulo: 'Envasando' },
  { id: 'fraccionado', titulo: 'Fraccionado' },
  { id: 'terminadas', titulo: 'Terminadas hoy' },
]

export function columnaFlujo(f: FilaFlujo): Columna {
  if (f.estado === 'finalizada' || f.estado === 'finalizado') return 'terminadas'
  if (f.entidad === 'fraccionado') return 'fraccionado'
  if (f.entidad === 'envasado') return f.estado === 'cola' ? 'para_envasar' : 'envasando'
  if (f.estado === 'cola') return 'cola'
  if (f.estado === 'para_envasar') return 'para_envasar'
  return 'fabricando'
}

export function agruparFlujo(filas: FilaFlujo[]): Record<Columna, FilaFlujo[]> {
  const grupos = Object.fromEntries(COLUMNAS.map((c) => [c.id, [] as FilaFlujo[]])) as Record<Columna, FilaFlujo[]>
  for (const f of filas) grupos[columnaFlujo(f)].push(f)
  for (const c of COLUMNAS) {
    grupos[c.id].sort((a, b) =>
      c.id === 'terminadas'
        ? (b.fin ?? '').localeCompare(a.fin ?? '')
        : Number(b.corriendo) - Number(a.corriendo) || a.created_at.localeCompare(b.created_at),
    )
  }
  return grupos
}

export function kpisFlujo(filas: FilaFlujo[]): { cola: number; fabricando: number; envasando: number; litrosHoy: number } {
  const k = { cola: 0, fabricando: 0, envasando: 0, litrosHoy: 0 }
  for (const f of filas) {
    const c = columnaFlujo(f)
    if (c === 'cola') k.cola += 1
    else if (c === 'fabricando') k.fabricando += 1
    else if (c === 'envasando') k.envasando += 1
    else if (c === 'terminadas' && f.entidad === 'fabricacion') k.litrosHoy += f.litros ?? 0
  }
  return k
}
