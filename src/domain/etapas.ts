// Etapas por las que pasa una orden, para la barra segmentada (Flujo, detalle y tablet).
// `pausada`: la orden está en pausa en su etapa (la barra no muestra la luz «en marcha»).
export type SecuenciaEtapas = { nombres: string[]; actual: number; pausada: boolean }

const SECUENCIAS: Record<string, { nombres: string[]; posicion: Record<string, number> }> = {
  fabricacion: {
    nombres: ['Cola', 'Fabricando', 'Control', 'Para envasar', 'Terminada'],
    // pausada queda en Fabricando: es donde se pausó
    posicion: { cola: 0, fabricando: 1, pausada: 1, en_control: 2, para_envasar: 3, finalizada: 4 },
  },
  envasado: {
    nombres: ['Cola', 'Envasando', 'Terminado'],
    posicion: { cola: 0, activo: 1, pausado: 1, finalizado: 2 },
  },
  fraccionado: {
    nombres: ['Cola', 'Fraccionando', 'Terminado'],
    posicion: { cola: 0, activo: 1, pausado: 1, finalizado: 2 },
  },
}

const PAUSADOS = new Set(['pausada', 'pausado'])

// null si la orden está cancelada o el estado no es de la secuencia: no se dibuja una barra que mienta.
export function etapasDe(entidad: string, estado: string): SecuenciaEtapas | null {
  const s = SECUENCIAS[entidad]
  const actual = s?.posicion[estado]
  return s && actual !== undefined ? { nombres: s.nombres, actual, pausada: PAUSADOS.has(estado) } : null
}
