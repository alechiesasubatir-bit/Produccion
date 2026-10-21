// Placeholder: se implementa en la Task 5 del plan 3.
export type TipoOrden = 'fabricacion' | 'envasado' | 'fraccionado'

export function NuevaOrden(_: {
  abierta: boolean
  tipoInicial?: TipoOrden
  tanqueInicial?: string
  onCerrar: () => void
  onCreada: () => void
}) {
  return null
}
