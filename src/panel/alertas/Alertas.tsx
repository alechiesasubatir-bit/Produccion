import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { separarAlertas, type Alerta } from '../../domain/alertas'
import { mensajeError } from '../../lib/errores'
import { useEnLinea } from '../../lib/useEnLinea'
import { marcarLeida, posponerAlerta } from './datosAlertas'
import { guardarSonido, sonarAlerta, sonidoActivado } from './sonido'

const POSPONER: Array<[number, string]> = [
  [1, '1 hora'],
  [4, '4 horas'],
  [24, '1 día'],
]

function hace(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}

export function Alertas({ todas, recargar }: { todas: Alerta[]; recargar: () => void }) {
  const navegar = useNavigate()
  const enLinea = useEnLinea()
  const [aviso, setAviso] = useState<string | null>(null)
  const [sonido, setSonido] = useState(sonidoActivado)
  const { activas, pospuestas, leidas } = separarAlertas(todas, new Date())

  const hacer = async (p: Promise<{ error: unknown }>) => {
    const r = await p
    setAviso(r.error ? mensajeError(r.error).texto : null)
    recargar()
  }

  const alternarSonido = () => {
    const nuevo = !sonido
    setSonido(nuevo)
    guardarSonido(nuevo)
    if (nuevo) sonarAlerta() // de paso, el clic habilita el audio en el navegador
  }

  return (
    <div className="alertas">
      <div className="vista-barra">
        <h1 className="titulo-panel">Alertas</h1>
        <label className="interruptor">
          <input type="checkbox" checked={sonido} onChange={alternarSonido} />
          Sonido
        </label>
      </div>
      {aviso && (
        <p className="aviso-panel" role="alert">
          {aviso}
        </p>
      )}

      <section aria-label="Activas" className="lista-alertas">
        <h2>Activas</h2>
        {activas.length === 0 && <p className="vacio">No hay alertas activas.</p>}
        {activas.map((a) => (
          <article key={a.id} className={`alerta alerta-${a.tipo}`}>
            <div className="alerta-texto">
              <strong>{a.texto}</strong>
              <span className="apagado">{hace(a.creada)}</span>
            </div>
            <div className="alerta-acciones">
              <button type="button" className="boton-mini" onClick={() => navegar('/panel')}>
                Ver en el flujo
              </button>
              <button type="button" className="boton-mini" disabled={!enLinea} onClick={() => void hacer(marcarLeida(a.id))}>
                Marcar leída
              </button>
              {POSPONER.map(([h, texto]) => (
                <button
                  key={h}
                  type="button"
                  className="boton-mini"
                  disabled={!enLinea}
                  onClick={() => void hacer(posponerAlerta(a.id, new Date(Date.now() + h * 3_600_000).toISOString()))}
                >
                  Posponer {texto}
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section aria-label="Pospuestas y leídas" className="lista-alertas atenuada">
        <h2>Pospuestas y leídas</h2>
        {pospuestas.length + leidas.length === 0 && <p className="vacio">Nada por acá.</p>}
        {[...pospuestas, ...leidas].map((a) => (
          <article key={a.id} className="alerta">
            <div className="alerta-texto">
              <span>{a.texto}</span>
              <span className="apagado">
                {a.leida
                  ? 'Leída'
                  : `Pospuesta hasta las ${new Date(a.pospuesta_hasta!).toLocaleTimeString('es-UY', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                      timeZone: 'America/Montevideo',
                    })}`}
              </span>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
