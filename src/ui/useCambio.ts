import { useEffect, useState } from 'react'

// Último valor visto por clave (p. ej. `fabricacion-<id>` → estado), fuera de los componentes: una tarjeta
// que cambia de columna se desmonta y se vuelve a montar, y sin esto olvidaría su estado anterior.
const vistos = new Map<string, unknown>()

// Cuántas veces cambió `valor` desde que se montó (0 al montar). Sirve para repetir una animación solo
// cuando el valor cambia en vivo, no en la primera carga. Con `clave`, al montar arranca en 1 si esa clave
// ya se vio con otro valor (la orden cambió de etapa y por eso cambió de lugar); una clave nueva cuenta 0.
// Patrón de React para «guardar la prop anterior» en estado (sin refs en el render).
export function useCambio<T>(valor: T, clave?: string): number {
  const [anterior, setAnterior] = useState(valor)
  const [cambios, setCambios] = useState(() =>
    clave !== undefined && vistos.has(clave) && !Object.is(vistos.get(clave), valor) ? 1 : 0,
  )
  if (!Object.is(anterior, valor)) {
    setAnterior(valor)
    setCambios(cambios + 1)
  }
  useEffect(() => {
    if (clave !== undefined) vistos.set(clave, valor)
  }, [clave, valor])
  return cambios
}
