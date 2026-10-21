import { useEffect, useRef } from 'react'

const DURACION_MS = 1200

function sinMovimiento(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Check dibujado + estallido del color del producto; vuelve solo a "Mis tareas".
export function Confirmacion({ color, texto, onFin }: { color: string; texto: string; onFin: () => void }) {
  const onFinRef = useRef(onFin)
  onFinRef.current = onFin

  useEffect(() => {
    if (sinMovimiento()) {
      onFinRef.current()
      return
    }
    const id = setTimeout(() => onFinRef.current(), DURACION_MS)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className="confirmacion" role="status" aria-live="assertive">
      <span className="confirmacion-estallido" style={{ background: color }} aria-hidden="true" />
      <svg className="confirmacion-check" viewBox="0 0 52 52" width="120" height="120" aria-hidden="true">
        <circle cx="26" cy="26" r="24" fill="none" stroke={color} strokeWidth="3" />
        <path d="M15 27 l8 8 l15 -17" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="confirmacion-texto">{texto}</p>
    </div>
  )
}
