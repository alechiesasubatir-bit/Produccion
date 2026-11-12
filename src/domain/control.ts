import { parsearCantidad } from './tareas'

export type FormControl = {
  ph: string
  densidad: string
  perfumeOk: boolean | null
  perfumeComentario: string
  visualOk: boolean | null
  visualComentario: string
  observaciones: string
}

export type ControlHistorial = {
  intento: number
  resultado: 'aprobado' | 'rechazado'
  ph: number | null
  densidad: number | null
  perfume_ok: boolean
  perfume_comentario: string | null
  visual_ok: boolean
  visual_comentario: string | null
  observaciones: string | null
  firmado_nombre: string | null
  origen: 'panel' | 'tablet'
  created_at: string
}

export const FORM_CONTROL_VACIO: FormControl = {
  ph: '',
  densidad: '',
  perfumeOk: null,
  perfumeComentario: '',
  visualOk: null,
  visualComentario: '',
  observaciones: '',
}

// El pH admite 0, que parsearCantidad rechaza (pide > 0).
const parsearPh = (texto: string): number | null => (/^0([.,]0*)?$/.test(texto.trim()) ? 0 : parsearCantidad(texto))

export function validarControl(f: FormControl, esPolvo: boolean): Partial<Record<keyof FormControl, string>> {
  const e: Partial<Record<keyof FormControl, string>> = {}
  if (!esPolvo) {
    if (f.ph.trim() === '') e.ph = 'Falta el pH.'
    else {
      const ph = parsearPh(f.ph)
      if (ph === null || ph > 14) e.ph = 'El pH va de 0 a 14.'
    }
    if (f.densidad.trim() === '') e.densidad = 'Falta la densidad.'
    else if (parsearCantidad(f.densidad) === null) e.densidad = 'La densidad tiene que ser mayor a 0.'
  }
  if (f.perfumeOk === null) e.perfumeOk = 'Marcá OK o No OK.'
  else if (!f.perfumeOk && f.perfumeComentario.trim() === '') e.perfumeComentario = 'Explicá qué está mal.'
  if (f.visualOk === null) e.visualOk = 'Marcá OK o No OK.'
  else if (!f.visualOk && f.visualComentario.trim() === '') e.visualComentario = 'Explicá qué está mal.'
  return e
}

export const hayNoOk = (f: Pick<FormControl, 'perfumeOk' | 'visualOk'>): boolean => f.perfumeOk === false || f.visualOk === false

// Mismo formato que el motivo del evento en registrar_control (SQL).
export function motivoRechazo(c: {
  perfumeOk: boolean | null
  perfumeComentario: string
  visualOk: boolean | null
  visualComentario: string
  observaciones: string
}): string {
  const partes: string[] = []
  if (c.perfumeOk === false) partes.push(`perfume No OK (${c.perfumeComentario.trim()})`)
  if (c.visualOk === false) partes.push(`visual No OK (${c.visualComentario.trim()})`)
  if (c.observaciones.trim()) partes.push(c.observaciones.trim())
  return partes.join('; ')
}
