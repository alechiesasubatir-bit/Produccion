import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

declare const __VERSION__: string

const CADA_MS = 2 * 60 * 1000
const MONITOR_SEG = 30

// ¿El sitio publicado tiene una versión distinta de la que está corriendo?
export async function hayVersionNueva(actual: string, base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return false
    const { version } = (await r.json()) as { version?: string }
    return typeof version === 'string' && version !== actual
  } catch {
    return false // sin red o archivo raro: no molestar
  }
}

// Recarga salteando la caché (main.tsx quita el ?v= al arrancar).
export function recargar() {
  const u = new URL(window.location.href)
  u.searchParams.set('v', String(Date.now()))
  window.location.replace(u.toString())
}

/**
 * Avisa que se publicó una actualización. En el Monitor (TV, nadie toca la pantalla) se recarga sola.
 * Solo en el sitio publicado: en desarrollo no hay version.json.
 */
export function AvisoActualizacion({
  version = typeof __VERSION__ === 'string' ? __VERSION__ : '',
  activo = import.meta.env.PROD,
}: {
  version?: string
  activo?: boolean
}) {
  const [nueva, setNueva] = useState(false)
  const enMonitor = useLocation().pathname.includes('/monitor')
  const [segundos, setSegundos] = useState(MONITOR_SEG)

  useEffect(() => {
    if (!activo || !version || nueva) return
    let vivo = true
    const revisar = () => {
      if (document.visibilityState === 'hidden') return
      void hayVersionNueva(version, import.meta.env.BASE_URL).then((si) => vivo && si && setNueva(true))
    }
    revisar()
    const id = setInterval(revisar, CADA_MS)
    document.addEventListener('visibilitychange', revisar)
    return () => {
      vivo = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', revisar)
    }
  }, [activo, version, nueva])

  useEffect(() => {
    if (!nueva || !enMonitor) return
    const id = setInterval(() => setSegundos((s) => s - 1), 1000)
    return () => clearInterval(id)
  }, [nueva, enMonitor])

  useEffect(() => {
    if (nueva && enMonitor && segundos <= 0) recargar()
  }, [nueva, enMonitor, segundos])

  if (!nueva) return null
  return (
    <div className="aviso-actualizacion" role="status">
      <span className="aviso-actualizacion-punto" aria-hidden="true" />
      <span>
        <strong>Hay una actualización.</strong>{' '}
        {enMonitor ? `La pantalla se actualiza sola en ${Math.max(0, segundos)} s.` : 'Actualizá para ver la versión nueva.'}
      </span>
      <button type="button" className="boton" onClick={recargar}>
        Actualizar
      </button>
    </div>
  )
}
