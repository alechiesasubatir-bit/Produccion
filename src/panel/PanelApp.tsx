import { NavLink, Route, Routes } from 'react-router-dom'
import { salir, useSesion } from '../auth/useSesion'
import { useEnLinea } from '../lib/useEnLinea'
import { Alertas } from './alertas/Alertas'
import { useAlertas } from './alertas/useAlertas'
import { useAvisoSonoro } from './alertas/useAvisoSonoro'
import { Configuracion } from './config/Configuracion'
import { Flujo } from './Flujo'
import { Historial } from './historial/Historial'
import { Kpis } from './kpis/Kpis'
import { Tanques } from './Tanques'
import './panel.css'

const PESTANAS = [
  { a: '/panel', texto: 'Flujo', end: true },
  { a: '/panel/tanques', texto: 'Tanques', end: false },
  { a: '/panel/historial', texto: 'Historial', end: false },
  { a: '/panel/kpis', texto: 'KPIs', end: false },
  { a: '/panel/alertas', texto: 'Alertas', end: false },
  { a: '/panel/config', texto: 'Configuración', end: false },
]

export function PanelApp() {
  const { usuario } = useSesion()
  const enLinea = useEnLinea()
  // Una sola suscripción a alertas para todo el panel (contador, sonido y la vista).
  const alertas = useAlertas()
  useAvisoSonoro(alertas.activas.map((a) => a.id))

  return (
    <div className="app panel">
      <header className="encabezado">
        <div className="marca">
          <span className="marca-nombre">ProdControl</span>
          <nav className="pestanas" aria-label="Secciones del panel">
            {PESTANAS.map((p) => (
              <NavLink key={p.a} to={p.a} end={p.end} className="pestana">
                {p.texto}
                {p.a === '/panel/alertas' && alertas.activas.length > 0 && (
                  <span className="globo" aria-label={`${alertas.activas.length} activas`}>
                    {alertas.activas.length}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="encabezado-usuario">
          <span>{usuario?.email}</span>
          <button type="button" className="boton boton-sec" onClick={() => void salir()}>
            Salir
          </button>
        </div>
      </header>
      <main className="contenido">
        {!enLinea && (
          <div className="banda-offline" role="status">
            Sin conexión — no se pueden guardar cambios.
          </div>
        )}
        <Routes>
          <Route index element={<Flujo />} />
          <Route path="tanques" element={<Tanques />} />
          <Route path="historial" element={<Historial />} />
          <Route path="kpis" element={<Kpis />} />
          <Route path="alertas" element={<Alertas todas={alertas.todas} recargar={alertas.recargar} />} />
          <Route path="config" element={<Configuracion />} />
        </Routes>
      </main>
    </div>
  )
}
