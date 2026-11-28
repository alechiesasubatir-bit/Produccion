import { useEffect, useRef } from 'react'
import { useCambio } from './useCambio'

// La tarjeta da un pequeño salto cuando `valor` (su estado) cambia en vivo; al montar no salta.
// Usa la propiedad `scale` (no `transform`) para no pelear con las animaciones de layout de motion,
// y no vuelve a montar nada, así no se pierden el foco ni el estado de la tarjeta. Con `clave` también salta
// cuando la tarjeta reaparece en otra columna o sección con otro estado (ver useCambio).
export function useSalto<T extends HTMLElement>(valor: unknown, clave?: string) {
  const ref = useRef<T>(null)
  const cambios = useCambio(valor, clave)
  useEffect(() => {
    if (cambios === 0) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    ref.current?.animate?.([{ scale: '1' }, { scale: '1.04' }, { scale: '1' }], { duration: 450, easing: 'cubic-bezier(.22, 1, .36, 1)' })
  }, [cambios])
  return ref
}
