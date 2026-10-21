import { NavLink, Route, Routes } from 'react-router-dom'
import { salir, useSesion } from '../auth/useSesion'
import { BarraDemo } from '../demo/BarraDemo'
import { useEnLinea } from '../lib/useEnLinea'
import { Alertas } from './alertas/Alertas'
import { useAlertas } from './alertas/useAlertas'
import { useAvisoSonoro } from './alertas/useAvisoSonoro'
import { Configuracion } from './config/Configuracion'
import { Flujo } from './Flujo'
import { Historial } from './historial/Historial'
import { Kpis } from './kpis/Kpis'
import { Monitor } from './monitor/Monitor'
import { Tanques } from './Tanques'
import './panel.css'

type Pestana = { a: string; texto: string; end: boolean; enDemo: boolean }

const PESTANAS: Pestana[] = [
  { a: '', texto: 'Flujo', end: true, enDemo: true },
  { a: '/tanques', texto: 'Tanques', end: false, enDemo: true },
  { a: '/historial', texto: 'Historial', end: false, enDemo: false },
  { a: '/kpis', texto: 'KPIs', end: false, enDemo: false },
  { a: '/alertas', texto: 'Alertas', end: false, enDemo: false },
  { a: '/config', texto: 'Configuración', end: false, enDemo: false },
  { a: '/monitor', texto: 'Monitor', end: false, enDemo: true },
]

// `base` es la raíz de las rutas ('/panel' o '/demo'). En la demo se ven solo las vistas en vivo,
// con datos simulados (ver src/demo) y sin usuario.
export function PanelApp({ base = '/panel', demo = false }: { base?: string; demo?: boolean }) {
  const { usuario } = useSesion()
  const enLinea = useEnLinea()
  // Una sola suscripción a alertas para todo el panel (contador, sonido y la vista).
  const alertas = useAlertas()
  useAvisoSonoro(alertas.activas.map((a) => a.id), alertas.cargado)

  return (
    <div className={`app panel${demo ? ' es-demo' : ''}`}>
      <header className="encabezado">
        <div className="marca">
          <span className="marca-nombre">Control de Producción</span>
          <nav className="pestanas" aria-label="Secciones del panel">
            {PESTANAS.filter((p) => !demo || p.enDemo).map((p) => (
              <NavLink key={p.a} to={base + p.a} end={p.end} className="pestana">
                {p.texto}
                {p.a === '/alertas' && alertas.activas.length > 0 && (
                  <span className="globo" aria-label={`${alertas.activas.length} activas`}>
                    {alertas.activas.length}
                  </span>
                )}
              </NavLink>
            ))}
            {!demo && (
              <a className="pestana pestana-demo" href={`${import.meta.env.BASE_URL}demo`} target="_blank" rel="noopener">
                DEMO
              </a>
            )}
          </nav>
        </div>
        {demo ? (
          <BarraDemo />
        ) : (
          <div className="encabezado-usuario">
            <span>{usuario?.email}</span>
            <button type="button" className="boton boton-sec" onClick={() => void salir()}>
              Salir
            </button>
          </div>
        )}
      </header>
      <main className="contenido">
        {!enLinea && !demo && (
          <div className="banda-offline" role="status">
            Sin conexión — no se pueden guardar cambios.
          </div>
        )}
        <Routes>
          <Route index element={<Flujo />} />
          <Route path="tanques" element={<Tanques />} />
          <Route path="monitor" element={<Monitor salir={base} />} />
          {!demo && (
            <>
              <Route path="historial" element={<Historial />} />
              <Route path="kpis" element={<Kpis />} />
              <Route path="alertas" element={<Alertas todas={alertas.todas} recargar={alertas.recargar} />} />
              <Route path="config" element={<Configuracion />} />
            </>
          )}
        </Routes>
      </main>
    </div>
  )
}
