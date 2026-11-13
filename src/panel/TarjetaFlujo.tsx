import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { accionesPosibles, type Accion } from '../domain/acciones'
import type { FilaFlujo } from '../domain/flujo'
import { nivelTanque, type EstadoTanque } from '../domain/tanque'
import { confirmacionPanel, etiquetaPanel, tituloTarea } from '../domain/tareas'
import { Cronometro } from '../planta/TarjetaTarea'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'
import { DialogoControl } from './DialogoControl'
import { OperariasOrden } from './OperariasOrden'

const CONFIRMAR: Accion[] = ['cancelar', 'finalizar']

function estadoMini(f: FilaFlujo): EstadoTanque {
  if (f.entidad === 'fabricacion') return f.estado === 'finalizada' ? 'libre' : (f.estado as EstadoTanque)
  if (f.estado === 'activo') return 'envasando'
  if (f.estado === 'pausado') return 'env_pausado'
  return 'cola_env'
}

// Como el cronómetro: minutos efectivos al cargar + lo transcurrido desde la carga.
function AvanceEstimado({ efectivos, cargadoEn, estimado }: { efectivos: number; cargadoEn: number; estimado: number }) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const transcurridos = efectivos + Math.max(0, ahora - cargadoEn) / 60_000
  const pct = Math.round((transcurridos / estimado) * 100)
  return (
    <div
      className={`avance${pct > 100 ? ' pasado' : ''}`}
      role="progressbar"
      aria-label={`Avance estimado: ${pct} % de ${estimado} min`}
      aria-valuenow={Math.min(pct, 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

export function TarjetaFlujo({
  fila,
  nombres,
  habilitado,
  cargadoEn,
  proyeccionMin = null,
  soloLectura = false,
  onAccion,
  onCargarEnvasado,
  onEditar,
}: {
  fila: FilaFlujo
  nombres: Map<string, string>
  habilitado: boolean
  cargadoEn: number
  /** Minutos estimados por la velocidad histórica (null si no hay historial). */
  proyeccionMin?: number | null
  /** Sin botones (Monitor de la TV). */
  soloLectura?: boolean
  onAccion: (a: Accion) => void
  /** Fabricación lista: abre Nueva orden → Envasado con este tanque. */
  onCargarEnvasado?: () => void
  /** Envasado sin terminar: abre el diálogo de edición. */
  onEditar?: () => void
}) {
  const [confirmando, setConfirmando] = useState<Accion | null>(null)
  const acciones = accionesPosibles(fila.entidad, fila.estado, 'panel')
  const [verOperarias, setVerOperarias] = useState(false)
  const [controlando, setControlando] = useState(false)
  const cerrarControl = useCallback(() => setControlando(false), [])
  const disparador = useRef<HTMLButtonElement>(null)
  const dialogo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!verOperarias) return
    const boton = disparador.current
    dialogo.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setVerOperarias(false)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      boton?.focus()
    }
  }, [verOperarias])
  const enOrden = (fila.operarias ?? []).map((o) => o.nombre)
  // Sin participaciones (órdenes anteriores) se usan las operarias guardadas en la propia orden.
  const operarias = enOrden.length
    ? enOrden
    : [fila.operaria_1, fila.operaria_2].filter((id): id is string => !!id).map((id) => nombres.get(id) ?? 'Operaria')
  const estado = estadoMini(fila)
  const enControl = fila.entidad === 'fabricacion' && fila.estado === 'en_control'
  const lista = fila.entidad === 'fabricacion' && fila.estado === 'para_envasar' && !!onCargarEnvasado
  // Nivel aproximado: lo que queda de la fabricación sobre lo fabricado.
  const nivel = nivelTanque({
    estado,
    capacidad: fila.litros ?? 1,
    litros: fila.litros ?? 1,
    litrosRestantes: fila.litros_restantes ?? fila.litros ?? 1,
    progresoFab: 0.6,
  })

  const tocar = (a: Accion) => {
    if (CONFIRMAR.includes(a) && confirmando !== a) {
      setConfirmando(a)
      return
    }
    setConfirmando(null)
    onAccion(a)
  }

  return (
    <motion.article layout layoutId={`${fila.entidad}-${fila.id}`} className="tarjeta-flujo"
      aria-label={tituloTarea(fila)}
      style={{ '--producto': fila.color ?? undefined } as CSSProperties}
    >
      <div className="tf-cabecera">
        {fila.tanque_codigo && <Tanque estado={estado} color={fila.color ?? undefined} tipo={fila.producto_tipo} nivel={nivel} ancho={28} />}
        <div className="tf-titulo">
          <span className="tf-nombre">{tituloTarea(fila)}</span>
          <span className="tf-meta">
            {fila.tanque_codigo && <span className="mono">{fila.tanque_codigo}</span>}
            {fila.lote && <span className="mono">Lote {fila.lote}</span>}
          </span>
        </div>
      </div>
      <div className="tf-pie">
        <Chip estado={fila.entidad === 'fraccionado' && fila.estado === 'activo' ? 'fraccionado' : fila.estado} />
        {operarias.length > 0 && <span className="tf-operarias">{operarias.join(' · ')}</span>}
        <Cronometro tarea={fila} cargadoEn={cargadoEn} />
      </div>
      {fila.corriendo && proyeccionMin ? (
        <AvanceEstimado efectivos={fila.min_efectivos ?? 0} cargadoEn={cargadoEn} estimado={proyeccionMin} />
      ) : null}
      {!soloLectura && (
        <div className="tf-acciones">
          <button ref={disparador} type="button" className="boton-mini discreto" onClick={() => setVerOperarias(true)}>
            Operarias
          </button>
          {enControl && (
            <button type="button" className="boton-mini principal" disabled={!habilitado} onClick={() => setControlando(true)}>
              Controlar
            </button>
          )}
          {lista && (
            <button type="button" className="boton-mini principal" disabled={!habilitado} onClick={onCargarEnvasado}>
              Cargar envasado
            </button>
          )}
          {onEditar && fila.entidad === 'envasado' && fila.estado !== 'finalizado' && fila.estado !== 'cancelado' && (
            <button type="button" className="boton-mini discreto" disabled={!habilitado} onClick={onEditar}>
              Editar
            </button>
          )}
          {acciones.map((a) => (
            <button
              key={a}
              type="button"
              className={`boton-mini${confirmando === a ? ' confirmar' : ''}${lista && a === 'finalizar' ? ' discreto' : ''}`}
              disabled={!habilitado}
              onClick={() => tocar(a)}
            >
              {confirmando === a ? confirmacionPanel(fila.entidad, fila.estado, a) : etiquetaPanel(fila.entidad, fila.estado, a)}
            </button>
          ))}
        </div>
      )}
      {controlando && (
        <DialogoControl
          fabricacionId={fila.id}
          esPolvo={fila.producto_tipo === 'polvo'}
          intento={fila.control_intento ?? 1}
          producto={fila.producto ?? undefined}
          onCerrar={cerrarControl}
        />
      )}
      {verOperarias &&
        createPortal(
          <div className="modal-fondo" onClick={() => setVerOperarias(false)}>
            <div
              ref={dialogo}
              tabIndex={-1}
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label="Operarias de la orden"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="modal-cabecera">
                <h2>{`Operarias · ${tituloTarea(fila)}`}</h2>
                <button type="button" className="boton boton-sec" onClick={() => setVerOperarias(false)} aria-label="Cerrar">
                  ×
                </button>
              </header>
              <OperariasOrden entidad={fila.entidad} id={fila.id} />
            </div>
          </div>,
          document.body,
        )}
    </motion.article>
  )
}
