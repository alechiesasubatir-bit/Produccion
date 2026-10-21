import type { Database } from '../lib/database.types'
import type { Accion } from './acciones'

export type Tarea = Database['produccion']['Views']['v_tareas']['Row']

const esMia = (t: Tarea, empleadoId: string) => t.operaria_1 === empleadoId || t.operaria_2 === empleadoId

// Orden: primero el tanque del QR, después lo que está corriendo, después por antigüedad.
function ordenar(tareas: Tarea[], tanque: string | null | undefined): Tarea[] {
  return [...tareas].sort((a, b) => {
    const qr = Number(!!tanque && b.tanque_codigo === tanque) - Number(!!tanque && a.tanque_codigo === tanque)
    if (qr) return qr
    const corriendo = Number(b.corriendo) - Number(a.corriendo)
    if (corriendo) return corriendo
    return a.created_at.localeCompare(b.created_at)
  })
}

export function clasificarTareas(
  tareas: Tarea[],
  empleadoId: string,
  tanque?: string | null,
): { mias: Tarea[]; disponibles: Tarea[] } {
  return {
    mias: ordenar(
      tareas.filter((t) => esMia(t, empleadoId)),
      tanque,
    ),
    disponibles: ordenar(
      tareas.filter((t) => t.estado === 'cola' && t.operaria_1 === null && t.listo),
      tanque,
    ),
  }
}

export function estadoOperaria(tareas: Tarea[], empleadoId: string): 'trabajando' | 'pausada' | null {
  const suyas = tareas.filter((t) => esMia(t, empleadoId))
  if (suyas.some((t) => t.corriendo)) return 'trabajando'
  if (suyas.some((t) => t.estado === 'pausada' || t.estado === 'pausado')) return 'pausada'
  return null
}

export function segundosTranscurridos(
  t: Pick<Tarea, 'min_efectivos' | 'corriendo'>,
  cargadoEn: number,
  ahora: number,
): number {
  const base = Math.round((t.min_efectivos ?? 0) * 60)
  return base + (t.corriendo ? Math.max(0, Math.floor((ahora - cargadoEn) / 1000)) : 0)
}

const dos = (n: number) => String(n).padStart(2, '0')

export function formatoCronometro(seg: number): string {
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`
}

const ETIQUETAS: Record<Accion, string> = {
  iniciar: 'Iniciar',
  pausar: 'Pausar',
  reanudar: 'Reanudar',
  finalizar: 'Finalizar',
  cancelar: 'Cancelar',
}

export function etiquetaAccion(accion: Accion, disponible: boolean): string {
  return accion === 'iniciar' && disponible ? 'Tomar' : ETIQUETAS[accion]
}

const PASADOS: Record<Accion, string> = {
  iniciar: 'empezaste',
  pausar: 'pausaste',
  reanudar: 'retomaste',
  finalizar: 'finalizaste',
  cancelar: 'cancelaste',
}

export function pasadoAccion(accion: Accion): string {
  return PASADOS[accion]
}

export function tituloTarea(t: Pick<Tarea, 'entidad' | 'producto' | 'litros' | 'cantidad' | 'presentacion' | 'descripcion'>): string {
  if (t.entidad === 'fabricacion') return `${t.producto ?? 'Fabricación'} · ${t.litros ?? '?'} L`
  if (t.entidad === 'envasado') return `${t.producto ?? 'Envasado'} · ${t.cantidad ?? '?'} × ${t.presentacion ?? '?'}`
  return t.descripcion ?? t.producto ?? 'Fraccionado'
}
