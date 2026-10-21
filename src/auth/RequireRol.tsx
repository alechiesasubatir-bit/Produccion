import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { salir, useSesion, type Rol } from './useSesion'

export function Cargando() {
  return (
    <div className="pantalla-centro" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  )
}

export function SinAcceso() {
  return (
    <div className="pantalla-centro">
      <div className="tarjeta-aviso">
        <h1>Sin acceso</h1>
        <p>Tu usuario no tiene permiso para esta parte de ProdControl. Pedile acceso a un administrador.</p>
        <button type="button" className="boton" onClick={() => void salir()}>
          Salir
        </button>
      </div>
    </div>
  )
}

export function SinVerificar() {
  return (
    <div className="pantalla-centro">
      <div className="tarjeta-aviso" role="alert">
        <h1>No pudimos verificar tu acceso</h1>
        <p>Parece un problema de conexión. Reintentamos solos en unos segundos.</p>
        <button type="button" className="boton" onClick={() => location.reload()}>
          Reintentar ahora
        </button>
      </div>
    </div>
  )
}

export function RequireRol({ rol, children }: { rol: Rol; children: ReactNode }) {
  const { cargando, usuario, rol: actual, errorPerfil } = useSesion()
  const loc = useLocation()

  if (cargando) return <Cargando />
  if (!usuario) {
    const next = encodeURIComponent(loc.pathname + loc.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (errorPerfil) return <SinVerificar />
  if (actual !== rol) return <SinAcceso />
  return <>{children}</>
}
