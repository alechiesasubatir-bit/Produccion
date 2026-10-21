import { useEffect, useRef, useState } from 'react'

const TIC_MS = 250

// Cuenta el tiempo sin toques ni teclas; al llegar a `ms` llama a `alExpirar` (una vez).
// Devuelve la fracción restante (1 → recién tocado, 0 → expirado) para dibujar el anillo.
export function useInactividad(activo: boolean, ms: number, alExpirar: () => void): number {
  const [restante, setRestante] = useState(1)
  const alExpirarRef = useRef(alExpirar)
  alExpirarRef.current = alExpirar

  useEffect(() => {
    if (!activo) {
      setRestante(1)
      return
    }
    let ultimo = Date.now()
    let expirado = false
    const tocar = () => {
      ultimo = Date.now()
      setRestante(1)
    }
    const id = setInterval(() => {
      if (expirado) return
      const r = Math.max(0, 1 - (Date.now() - ultimo) / ms)
      setRestante(r)
      if (r === 0) {
        expirado = true
        alExpirarRef.current()
      }
    }, TIC_MS)
    window.addEventListener('pointerdown', tocar)
    window.addEventListener('keydown', tocar)
    return () => {
      clearInterval(id)
      window.removeEventListener('pointerdown', tocar)
      window.removeEventListener('keydown', tocar)
    }
  }, [activo, ms])

  return activo ? restante : 1
}
