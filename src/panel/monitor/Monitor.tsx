import { LayoutGroup, MotionConfig } from 'motion/react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { agruparFlujo, COLUMNAS, kpisFlujo } from '../../domain/flujo'
import { nivelTanque } from '../../domain/tanque'
import { ahoraPlanta, horaMontevideo } from '../../lib/hora'
import { useRealtime } from '../../lib/useRealtime'
import { useTanques } from '../../pages/ParedTanques'
import { Tanque } from '../../ui/Tanque'
import { cargarFlujo, cargarOperarias } from '../datosFlujo'
import { KpisFlujo } from '../KpisFlujo'
import { TarjetaFlujo } from '../TarjetaFlujo'

const VISIBLES = 6 // tarjetas por columna; el resto se cuenta

function useHora() {
  const [ahora, setAhora] = useState(ahoraPlanta)
  useEffect(() => {
    const id = setInterval(() => setAhora(ahoraPlanta()), 1000)
    return () => clearInterval(id)
  }, [])
  return horaMontevideo(ahora)
}

const sinAccion = () => {}

// Vista para la TV de la planta: el flujo en grande, sin botones, con la tira de tanques abajo.
export function Monitor({ salir }: { salir: string }) {
  const flujo = useRealtime('v_flujo', cargarFlujo, ['fabricaciones', 'envasados', 'fraccionados'])
  const operarias = useRealtime('v_operarias', cargarOperarias, ['operarias'])
  const tanques = useTanques()
  const nombres = useMemo(() => new Map(operarias.datos.map((o) => [o.empleado_id, o.nombre])), [operarias.datos])
  const grupos = useMemo(() => agruparFlujo(flujo.datos), [flujo.datos])
  const kpis = useMemo(() => kpisFlujo(flujo.datos), [flujo.datos])
  const cargadoEn = useMemo(() => Date.now(), [flujo.datos])
  const hora = useHora()

  const pantallaCompleta = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void document.documentElement.requestFullscreen?.()
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="monitor">
        <header className="monitor-cabecera">
          <div className="monitor-marca">
            <span className="marca-nombre">Control de Producción</span>
            <span className="monitor-etiqueta">Monitor</span>
          </div>
          <KpisFlujo kpis={kpis} />
          <div className="monitor-derecha">
            <span className={`monitor-vivo${flujo.conectado ? '' : ' caido'}`}>
              <i aria-hidden="true" /> {flujo.conectado ? 'En vivo' : 'Sin conexión'}
            </span>
            <span className="monitor-hora" role="timer" aria-label="Hora">
              {hora}
            </span>
            <div className="monitor-botones">
              <button type="button" className="boton-mini" onClick={pantallaCompleta}>
                Pantalla completa
              </button>
              <Link className="boton-mini" to={salir}>
                Salir del monitor
              </Link>
            </div>
          </div>
        </header>

        <LayoutGroup>
          <div className="monitor-kanban">
            {COLUMNAS.map((c) => {
              const lista = grupos[c.id]
              return (
                <section key={c.id} className={`kanban-col col-${c.id}`} aria-label={c.titulo}>
                  <h2>
                    {c.titulo} <span className="kanban-contador">{lista.length}</span>
                  </h2>
                  <div className="kanban-lista">
                    {lista.slice(0, VISIBLES).map((f) => (
                      <TarjetaFlujo
                        key={`${f.entidad}-${f.id}`}
                        fila={f}
                        nombres={nombres}
                        habilitado={false}
                        cargadoEn={cargadoEn}
                        soloLectura
                        onAccion={sinAccion}
                      />
                    ))}
                    {lista.length > VISIBLES && <p className="monitor-mas">+{lista.length - VISIBLES} más</p>}
                  </div>
                </section>
              )
            })}
          </div>
        </LayoutGroup>

        <ul className="monitor-tanques" aria-label="Tanques">
          {tanques.datos.map((t) => {
            const libre = t.estado === 'libre'
            const pct = t.litros && t.litros_restantes !== null ? Math.round((t.litros_restantes / t.capacidad_l) * 100) : null
            return (
              <li
                key={t.tanque_id}
                className={`monitor-tanque estado-${t.estado}`}
                style={{ '--producto': t.color ?? undefined } as CSSProperties}
              >
                <Tanque
                  estado={t.estado}
                  color={t.color ?? undefined}
                  ancho={30}
                  nivel={nivelTanque({ estado: t.estado, capacidad: t.capacidad_l, litros: t.litros, litrosRestantes: t.litros_restantes })}
                  etiqueta={`Tanque ${t.codigo}: ${t.producto ?? 'libre'}`}
                />
                <span className="mt-codigo">{t.codigo}</span>
                <span className="mt-producto">{libre ? 'Libre' : t.producto}</span>
                {!libre && pct !== null && <span className="mt-pct">{pct}%</span>}
              </li>
            )
          })}
        </ul>
      </div>
    </MotionConfig>
  )
}
