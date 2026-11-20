import { columnaFlujo, esperandoFabricacion, type FilaFlujo } from './flujo'
import type { EstadoTanque } from './tanque'
import { tituloTarea } from './tareas'

// Lo que se lee del día en el Flujo, además del kanban: cuánto se terminó, a qué hora, quién está
// trabajando ahora y cómo están los tanques. Todo sale de v_flujo (las terminadas son las de hoy).

export type TrabajandoAhora = { empleadoId: string; nombre: string; desde: string; tarea: string; entidad: FilaFlujo['entidad'] }
export type HoraDia = { hora: number; litros: number; unidades: number; terminadas: number }

export type ResumenDia = {
  litros: number
  unidades: number
  terminadas: number
  /** Horas efectivas (sin pausas) de lo terminado hoy. */
  minutosEfectivos: number
  porHora: HoraDia[]
  trabajando: TrabajandoAhora[]
}

/** Horas que muestra el gráfico del día (se amplía si algo terminó antes o después). */
export const PRIMERA_HORA = 6
export const ULTIMA_HORA = 20

const horaDe = (iso: string) =>
  Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Montevideo' }).format(new Date(iso))) % 24

export function resumenDia(filas: FilaFlujo[]): ResumenDia {
  const visibles = filas.filter((f) => !esperandoFabricacion(f))
  const terminadas = visibles.filter((f) => columnaFlujo(f) === 'terminadas')
  let litros = 0
  let unidades = 0
  let minutosEfectivos = 0
  const horas = new Map<number, HoraDia>()

  for (const f of terminadas) {
    const l = f.entidad === 'fabricacion' && f.origen !== 'stock' ? (f.litros ?? 0) : 0
    const u = f.entidad !== 'fabricacion' ? (f.cantidad ?? 0) : 0
    litros += l
    unidades += u
    minutosEfectivos += f.min_efectivos ?? 0
    if (!f.fin) continue
    const h = horaDe(f.fin)
    const d = horas.get(h) ?? { hora: h, litros: 0, unidades: 0, terminadas: 0 }
    d.litros += l
    d.unidades += u
    d.terminadas += 1
    horas.set(h, d)
  }

  const conDatos = [...horas.keys()]
  const desde = Math.min(PRIMERA_HORA, ...conDatos)
  const hasta = Math.max(ULTIMA_HORA, ...conDatos)
  const porHora = Array.from({ length: hasta - desde + 1 }, (_, i) => horas.get(desde + i) ?? { hora: desde + i, litros: 0, unidades: 0, terminadas: 0 })

  // Una operaria aparece una vez: en la orden donde entró más recientemente.
  const trabajando = new Map<string, TrabajandoAhora>()
  for (const f of visibles) {
    if (columnaFlujo(f) === 'terminadas') continue
    for (const o of f.operarias ?? []) {
      const previa = trabajando.get(o.empleado_id)
      if (previa && previa.desde >= o.desde) continue
      trabajando.set(o.empleado_id, { empleadoId: o.empleado_id, nombre: o.nombre, desde: o.desde, tarea: tituloTarea(f), entidad: f.entidad })
    }
  }

  return {
    litros,
    unidades,
    terminadas: terminadas.length,
    minutosEfectivos,
    porHora,
    trabajando: [...trabajando.values()].sort((a, b) => a.desde.localeCompare(b.desde)),
  }
}

export type GrupoTanques = 'trabajando' | 'esperando' | 'pausados' | 'libres'
export const GRUPOS_TANQUE: { id: GrupoTanques; titulo: string }[] = [
  { id: 'trabajando', titulo: 'Trabajando' },
  { id: 'esperando', titulo: 'Esperando' },
  { id: 'pausados', titulo: 'En pausa' },
  { id: 'libres', titulo: 'Libres' },
]

export function grupoTanque(e: EstadoTanque): GrupoTanques {
  if (e === 'libre') return 'libres'
  if (e === 'fabricando' || e === 'envasando') return 'trabajando'
  if (e === 'pausada' || e === 'env_pausado') return 'pausados'
  return 'esperando' // cola, en control, para envasar, cola de envasado
}

export function tanquesPorGrupo(estados: EstadoTanque[]): Record<GrupoTanques, number> {
  const r: Record<GrupoTanques, number> = { trabajando: 0, esperando: 0, pausados: 0, libres: 0 }
  for (const e of estados) r[grupoTanque(e)] += 1
  return r
}
