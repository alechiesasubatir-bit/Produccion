import type { Database } from '../lib/database.types'
import type { FilaHistorial } from './historial'

export type Estandar = Database['produccion']['Views']['v_tiempos_estandar']['Row']

// Una fabricación está hecha cuando termina de fabricarse (para_envasar), no cuando se termina de
// envasar el tanque; envasados y fraccionados, cuando se finalizan.
export const terminada = (f: Pick<FilaHistorial, 'entidad' | 'estado'>) =>
  f.entidad === 'fabricacion' ? f.estado === 'para_envasar' || f.estado === 'finalizada' : f.estado === 'finalizado'
const un = (n: number) => Math.round(n * 10) / 10

// Igual que la app vieja: por operaria, unidades envasadas / minutos (ahora efectivos).
export function rankingOperarias(filas: FilaHistorial[]) {
  const m = new Map<string, { nombre: string; tareas: number; unidades: number; minutos: number }>()
  for (const f of filas) {
    if (f.entidad !== 'envasado' || !terminada(f)) continue
    for (const [id, nombre] of [
      [f.operaria_1, f.operaria_1_nombre],
      [f.operaria_2, f.operaria_2_nombre],
    ] as const) {
      if (!id) continue
      const o = m.get(id) ?? { nombre: nombre ?? 'Operaria', tareas: 0, unidades: 0, minutos: 0 }
      o.tareas += 1
      o.unidades += f.cantidad ?? 0
      o.minutos += f.min_efectivos ?? 0
      m.set(id, o)
    }
  }
  return [...m.values()]
    .map((o) => ({ ...o, minutos: Math.round(o.minutos), unidadesPorMin: o.minutos > 0 ? un(o.unidades / o.minutos) : 0 }))
    .sort((a, b) => b.unidades - a.unidades)
}

export function porProducto(filas: FilaHistorial[]) {
  const m = new Map<string, { producto: string; presentacion: string; tareas: number; unidades: number; litros: number; vel: number[] }>()
  for (const f of filas) {
    if (f.entidad !== 'envasado' || !terminada(f)) continue
    const k = `${f.producto}|${f.presentacion}`
    const p = m.get(k) ?? { producto: f.producto ?? '?', presentacion: f.presentacion ?? '?', tareas: 0, unidades: 0, litros: 0, vel: [] }
    p.tareas += 1
    p.unidades += f.cantidad ?? 0
    p.litros += f.litros ?? 0
    if (f.cantidad && f.min_efectivos && f.min_efectivos > 0) p.vel.push(f.cantidad / f.min_efectivos)
    m.set(k, p)
  }
  return [...m.values()]
    .map(({ vel, ...p }) => ({ ...p, unidadesPorMin: vel.length ? un(vel.reduce((a, b) => a + b, 0) / vel.length) : 0 }))
    .sort((a, b) => b.unidades - a.unidades)
}

export function resumenOperaciones(filas: FilaHistorial[]) {
  const r = {
    fabricaciones: 0,
    envasados: 0,
    fraccionados: 0,
    litrosFabricados: 0,
    unidadesEnvasadas: 0,
    minutosEfectivos: 0,
    minutosPausa: 0,
  }
  for (const f of filas) {
    if (!terminada(f)) continue
    if (f.entidad === 'fabricacion') {
      r.fabricaciones += 1
      r.litrosFabricados += f.litros ?? 0
    } else if (f.entidad === 'envasado') {
      r.envasados += 1
      r.unidadesEnvasadas += f.cantidad ?? 0
    } else r.fraccionados += 1
    r.minutosEfectivos += f.min_efectivos ?? 0
    r.minutosPausa += f.min_pausa ?? 0
  }
  r.minutosEfectivos = Math.round(r.minutosEfectivos)
  r.minutosPausa = Math.round(r.minutosPausa)
  return r
}

// Fabricación: L/min reales del rango contra el estándar (litros/hora configurado, o la velocidad
// histórica si no hay). desvioPct > 0 = más lento que el estándar.
export function tiemposVsEstandar(filas: FilaHistorial[], estandar: Estandar[]) {
  const m = new Map<string, number[]>()
  for (const f of filas) {
    if (f.entidad !== 'fabricacion' || !terminada(f) || !f.litros || !f.min_efectivos || f.min_efectivos <= 0) continue
    const l = m.get(f.producto ?? '?') ?? []
    l.push(f.litros / f.min_efectivos)
    m.set(f.producto ?? '?', l)
  }
  return [...m.entries()].map(([producto, vel]) => {
    const real = un(vel.reduce((a, b) => a + b, 0) / vel.length)
    const e = estandar.find((s) => s.entidad === 'fabricacion' && s.clave === producto)
    const std = e ? un(e.litros_hora_std ? e.litros_hora_std / 60 : e.velocidad) : null
    return { producto, real, estandar: std, desvioPct: std ? Math.round(((std - real) / std) * 100) : null }
  })
}
