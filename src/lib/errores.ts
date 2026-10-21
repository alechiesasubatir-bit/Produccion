export type CodigoError =
  | 'NO_AUTORIZADO'
  | 'PIN_INCORRECTO'
  | 'PIN_BLOQUEADO'
  | 'OPERARIA_INACTIVA'
  | 'TRANSICION_INVALIDA'
  | 'OPERARIA_OCUPADA'
  | 'TANQUE_NO_LISTO'
  | 'NO_ENCONTRADO'
  | 'TANQUE_OCUPADO'
  | 'OPERARIA_DUPLICADA'
  | 'NO_PROPIO_ROL'
  | 'PIN_INVALIDO'
  | 'NOMBRE_DUPLICADO'
  | 'RED'
  | 'DESCONOCIDO'

const TEXTOS: Record<CodigoError, (detalle: string | null) => string> = {
  NO_AUTORIZADO: () => 'No tenés permiso para esta acción.',
  PIN_INCORRECTO: () => 'PIN incorrecto. Probá de nuevo.',
  PIN_BLOQUEADO: () => 'Demasiados intentos. Esperá un minuto.',
  OPERARIA_INACTIVA: () => 'Tu usuario está inactivo. Avisá a la encargada.',
  TRANSICION_INVALIDA: (d) => (d ? `Esta tarea ${d}.` : 'Esta tarea ya cambió de estado.'),
  OPERARIA_OCUPADA: (d) => (d ? `Ya estás envasando ${d}.` : 'Ya estás en otro envasado.'),
  TANQUE_NO_LISTO: () => 'El tanque todavía no está listo para envasar.',
  NO_ENCONTRADO: () => 'La tarea ya no existe.',
  TANQUE_OCUPADO: () => 'Ese tanque ya tiene una orden abierta.',
  OPERARIA_DUPLICADA: () => 'Esa persona ya es operaria.',
  NO_PROPIO_ROL: () => 'No podés cambiar tu propio rol.',
  PIN_INVALIDO: () => 'El PIN son 4 dígitos.',
  NOMBRE_DUPLICADO: () => 'Ya existe uno con ese nombre.',
  RED: () => 'Sin conexión. Revisá el WiFi.',
  DESCONOCIDO: () => 'Algo salió mal. Avisá a la encargada.',
}

// Violaciones de constraint de Postgres (vienen de inserts directos del panel) → código propio.
const CONSTRAINTS: Array<[string, CodigoError]> = [
  ['fabricaciones_tanque_abierta_uk', 'TANQUE_OCUPADO'],
  ['operarias_pkey', 'OPERARIA_DUPLICADA'],
]

function esCodigo(x: unknown): x is CodigoError {
  return typeof x === 'string' && x in TEXTOS
}

function campo(err: object, nombre: string): unknown {
  return (err as Record<string, unknown>)[nombre]
}

// Fallas de red: fetch de Chrome/Firefox/Safari, y el {message:'TypeError: …'} con que postgrest-js
// resuelve (no rechaza) cuando no hay conexión.
const RED = /^(TypeError|FetchError)|Failed to fetch|Load failed|NetworkError|network/i

// Acepta errores de PostgREST ({message, details}), respuestas {ok:false, codigo, detalle}
// de produccion.accion() y fallas de red de fetch.
export function mensajeError(err: unknown): { codigo: CodigoError; texto: string } {
  if (err instanceof TypeError && RED.test(err.message)) {
    return { codigo: 'RED', texto: TEXTOS.RED(null) }
  }
  if (err && typeof err === 'object') {
    const codigo = campo(err, 'codigo') ?? campo(err, 'message')
    const detalle = campo(err, 'detalle') ?? campo(err, 'details')
    if (typeof codigo === 'string' && RED.test(codigo)) return { codigo: 'RED', texto: TEXTOS.RED(null) }
    if (campo(err, 'code') === '23505' && typeof codigo === 'string') {
      const c = CONSTRAINTS.find(([nombre]) => codigo.includes(nombre))
      if (c) return { codigo: c[1], texto: TEXTOS[c[1]](null) }
      return { codigo: 'NOMBRE_DUPLICADO', texto: TEXTOS.NOMBRE_DUPLICADO(null) }
    }
    if (esCodigo(codigo) && codigo !== 'RED' && codigo !== 'DESCONOCIDO') {
      return { codigo, texto: TEXTOS[codigo](typeof detalle === 'string' && detalle ? detalle : null) }
    }
  }
  return { codigo: 'DESCONOCIDO', texto: TEXTOS.DESCONOCIDO(null) }
}
