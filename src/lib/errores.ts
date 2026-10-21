export type CodigoError =
  | 'NO_AUTORIZADO'
  | 'PIN_INCORRECTO'
  | 'PIN_BLOQUEADO'
  | 'OPERARIA_INACTIVA'
  | 'TRANSICION_INVALIDA'
  | 'OPERARIA_OCUPADA'
  | 'TANQUE_NO_LISTO'
  | 'NO_ENCONTRADO'
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
  RED: () => 'Sin conexión. Revisá el WiFi.',
  DESCONOCIDO: () => 'Algo salió mal. Avisá a la encargada.',
}

function esCodigo(x: unknown): x is CodigoError {
  return typeof x === 'string' && x in TEXTOS
}

function campo(err: object, nombre: string): unknown {
  return (err as Record<string, unknown>)[nombre]
}

// Acepta errores de PostgREST ({message, details}), respuestas {ok:false, codigo, detalle}
// de produccion.accion() y fallas de red de fetch.
export function mensajeError(err: unknown): { codigo: CodigoError; texto: string } {
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return { codigo: 'RED', texto: TEXTOS.RED(null) }
  }
  if (err && typeof err === 'object') {
    const codigo = campo(err, 'codigo') ?? campo(err, 'message')
    const detalle = campo(err, 'detalle') ?? campo(err, 'details')
    if (esCodigo(codigo) && codigo !== 'RED' && codigo !== 'DESCONOCIDO') {
      return { codigo, texto: TEXTOS[codigo](typeof detalle === 'string' && detalle ? detalle : null) }
    }
  }
  return { codigo: 'DESCONOCIDO', texto: TEXTOS.DESCONOCIDO(null) }
}
