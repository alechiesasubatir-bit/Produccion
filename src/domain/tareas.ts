import type { Database } from '../lib/database.types'
import type { Accion, Entidad } from './acciones'
import type { Unidad } from './participaciones'

export type Tarea = Database['produccion']['Views']['v_tareas']['Row']

// Quiénes están trabajando ahora en la orden. Las órdenes en curso anteriores a la 014 no tienen
// `operarias` cargadas: ahí se cae a operaria_1/operaria_2.
function ids(t: Tarea): string[] {
  const op = t.operarias ?? []
  if (op.length > 0) return op.map((o) => o.empleado_id)
  return [t.operaria_1, t.operaria_2].filter((x): x is string => x !== null)
}

const esMia = (t: Tarea, empleadoId: string) => ids(t).includes(empleadoId)

const EN_CURSO = ['fabricando', 'pausada', 'activo', 'pausado']

export function esUltima(t: Tarea, empleadoId: string): boolean {
  const quienes = ids(t)
  return quienes.length === 1 && quienes[0] === empleadoId
}

export function unidadPorDefecto(t: Pick<Tarea, 'producto_tipo'>): Unidad {
  return t.producto_tipo === 'polvo' ? 'kg' : 'L'
}

export function pideCantidad(entidad: Entidad): boolean {
  return entidad === 'envasado' || entidad === 'fraccionado'
}

export function parsearCantidad(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(limpio)) return null
  const n = Number(limpio)
  return Number.isFinite(n) && n > 0 ? n : null
}

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
): { mias: Tarea[]; enControl: Tarea[]; enCurso: Tarea[]; disponibles: Tarea[] } {
  return {
    mias: ordenar(
      tareas.filter((t) => esMia(t, empleadoId) && t.estado !== 'en_control'),
      tanque,
    ),
    // En control: de todas, sin importar quién la fabricó.
    enControl: ordenar(
      tareas.filter((t) => t.entidad === 'fabricacion' && t.estado === 'en_control'),
      tanque,
    ),
    enCurso: ordenar(
      tareas.filter((t) => EN_CURSO.includes(t.estado) && !esMia(t, empleadoId)),
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
  sumarse: 'Sumarme',
  salir: 'Salir de la orden',
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
  sumarse: 'te sumaste',
  salir: 'saliste',
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

// En el panel, "finalizar" una fabricación que espera envasado no la termina: cierra el tanque y da
// por perdido lo que quede sin envasar. Se nombra y se confirma por lo que hace.
const esCierreConMerma = (entidad: Tarea['entidad'], estado: string, accion: Accion) =>
  entidad === 'fabricacion' && estado === 'para_envasar' && accion === 'finalizar'

export function etiquetaPanel(entidad: Tarea['entidad'], estado: string, accion: Accion): string {
  return esCierreConMerma(entidad, estado, accion) ? 'Cerrar con merma' : etiquetaAccion(accion, false)
}

export function confirmacionPanel(entidad: Tarea['entidad'], estado: string, accion: Accion): string {
  return esCierreConMerma(entidad, estado, accion) ? '¿Cerrar sin envasar?' : '¿Seguro?'
}
