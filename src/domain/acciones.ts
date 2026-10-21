export type Entidad = 'fabricacion' | 'envasado' | 'fraccionado'
export type Accion = 'iniciar' | 'pausar' | 'reanudar' | 'finalizar' | 'cancelar'

interface Transicion {
  entidad: Entidad
  estado: string
  accion: Accion
}

// Espejo de las transiciones de estado del RPC de base de datos (Task 5).
const TRANSICIONES_FABRICACION: Transicion[] = [
  { entidad: 'fabricacion', estado: 'cola', accion: 'iniciar' },
  { entidad: 'fabricacion', estado: 'fabricando', accion: 'pausar' },
  { entidad: 'fabricacion', estado: 'pausada', accion: 'reanudar' },
  { entidad: 'fabricacion', estado: 'fabricando', accion: 'finalizar' },
  { entidad: 'fabricacion', estado: 'cola', accion: 'cancelar' },
  { entidad: 'fabricacion', estado: 'fabricando', accion: 'cancelar' },
  { entidad: 'fabricacion', estado: 'pausada', accion: 'cancelar' },
]

// envasado y fraccionado comparten los mismos nombres de estado y la misma máquina de estados.
const TRANSICIONES_ENVASADO_FRACCIONADO: Array<{ estado: string; accion: Accion }> = [
  { estado: 'cola', accion: 'iniciar' },
  { estado: 'activo', accion: 'pausar' },
  { estado: 'pausado', accion: 'reanudar' },
  { estado: 'activo', accion: 'finalizar' },
  { estado: 'cola', accion: 'cancelar' },
  { estado: 'activo', accion: 'cancelar' },
  { estado: 'pausado', accion: 'cancelar' },
]

const TRANSICIONES: Transicion[] = [
  ...TRANSICIONES_FABRICACION,
  ...(['envasado', 'fraccionado'] as const).flatMap((entidad) =>
    TRANSICIONES_ENVASADO_FRACCIONADO.map(({ estado, accion }) => ({ entidad, estado, accion })),
  ),
]

const ORDEN_ACCIONES: Accion[] = ['iniciar', 'pausar', 'reanudar', 'finalizar', 'cancelar']

export function accionesPosibles(entidad: Entidad, estado: string, rol: 'panel' | 'planta'): Accion[] {
  const disponibles = new Set(
    TRANSICIONES.filter((t) => t.entidad === entidad && t.estado === estado).map((t) => t.accion),
  )

  if (rol === 'planta') disponibles.delete('cancelar')
  // Cierre manual de una fabricación con merma: solo el panel (migración 005).
  if (rol === 'panel' && entidad === 'fabricacion' && estado === 'para_envasar') disponibles.add('finalizar')

  return ORDEN_ACCIONES.filter((accion) => disponibles.has(accion))
}
