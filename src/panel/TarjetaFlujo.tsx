import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Accion } from '../domain/acciones'
import type { FilaFlujo } from '../domain/flujo'
import { tituloTarea } from '../domain/tareas'
import { Cronometro } from '../planta/TarjetaTarea'
import { etapasDe } from '../domain/etapas'
import { Chip } from '../ui/Chip'
import { Etapas } from '../ui/Etapas'
import { Tanque } from '../ui/Tanque'
import { useSalto } from '../ui/useSalto'
import { DetalleFlujo } from './DetalleFlujo'
import { DialogoControl } from './DialogoControl'
import { estadoMini, nivelMini, nombresOperarias } from './flujoMini'

function Barra({ pct, etiqueta, pasado = false }: { pct: number; etiqueta: string; pasado?: boolean }) {
  return (
    <span
      className={`avance${pasado ? ' pasado' : ''}`}
      role="progressbar"
      aria-label={etiqueta}
      aria-valuenow={Math.min(pct, 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${Math.min(pct, 100)}%` }} />
    </span>
  )
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
  return <Barra pct={pct} pasado={pct > 100} etiqueta={`Avance estimado: ${pct} % de ${estimado} min`} />
}

export function TarjetaFlujo({
  fila,
  nombres,
  habilitado,
  cargadoEn,
  envasados = [],
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
  /** Envasados cargados sobre esta fabricación, para el detalle. */
  envasados?: FilaFlujo[]
  /** Minutos estimados por la velocidad histórica (null si no hay historial). */
  proyeccionMin?: number | null
  /** Sin detalle ni botones (Monitor de la TV). */
  soloLectura?: boolean
  onAccion: (a: Accion) => void
  /** Fabricación lista: abre Nueva orden → Envasado con este tanque. */
  onCargarEnvasado?: () => void
  /** Envasado sin terminar: abre el diálogo de edición. */
  onEditar?: () => void
}) {
  const [detalle, setDetalle] = useState(false)
  const [controlando, setControlando] = useState(false)
  const cerrarControl = useCallback(() => setControlando(false), [])
  const disparador = useRef<HTMLButtonElement>(null)
  // salto cuando la orden cambia de estado en vivo
  const clave = `${fila.entidad}-${fila.id}`
  const tarjeta = useSalto<HTMLElement>(fila.estado, clave)
  const operarias = nombresOperarias(fila, nombres)
  const titulo = tituloTarea(fila)
  const etapas = etapasDe(fila.entidad, fila.estado)
  const enControl = fila.entidad === 'fabricacion' && fila.estado === 'en_control'
  const editable = !!onEditar && fila.entidad === 'envasado' && fila.estado !== 'finalizado' && fila.estado !== 'cancelado'
  // Fabricación esperando envasado: cuánto ya se envasó del tanque.
  const envasadoPct =
    fila.entidad === 'fabricacion' && fila.estado === 'para_envasar' && fila.litros && fila.litros_restantes !== null
      ? Math.round(((fila.litros - fila.litros_restantes) / fila.litros) * 100)
      : null

  // Lo que abre otro diálogo cierra antes el detalle: dos modales a la vez pelean por Escape y el foco.
  const yDespues = (f?: () => void) => (f ? () => (setDetalle(false), f()) : undefined)

  const cuerpo = (
    <>
      <span className="tf-cabecera">
        {fila.tanque_codigo && <Tanque estado={estadoMini(fila)} color={fila.color ?? undefined} tipo={fila.producto_tipo} nivel={nivelMini(fila)} ancho={22} />}
        <span className="tf-titulo">
          <span className="tf-nombre" title={titulo}>
            {titulo}
          </span>
          <span className="tf-meta">
            <Chip estado={fila.entidad === 'fraccionado' && fila.estado === 'activo' ? 'fraccionado' : fila.estado} clave={clave} />
            {fila.tanque_codigo && <span className="mono">{fila.tanque_codigo}</span>}
          </span>
        </span>
        <Cronometro tarea={fila} cargadoEn={cargadoEn} />
      </span>
      {operarias.length > 0 && (
        <span className="tf-operarias" title={operarias.join(' · ')}>
          {operarias.join(' · ')}
        </span>
      )}
      {etapas && <Etapas etapas={etapas} />}
      {fila.corriendo && proyeccionMin ? (
        <AvanceEstimado efectivos={fila.min_efectivos ?? 0} cargadoEn={cargadoEn} estimado={proyeccionMin} />
      ) : envasadoPct !== null ? (
        <Barra pct={envasadoPct} etiqueta={`Envasado: ${envasadoPct} % del tanque`} />
      ) : null}
    </>
  )

  return (
    <motion.article
      ref={tarjeta}
      layout
      layoutId={`${fila.entidad}-${fila.id}`}
      className="tarjeta-flujo"
      aria-label={titulo}
      style={{ '--producto': fila.color ?? undefined } as CSSProperties}
    >
      {soloLectura ? (
        <div className="tf-cuerpo">{cuerpo}</div>
      ) : (
        <button
          ref={disparador}
          type="button"
          className="tf-cuerpo tf-abrir"
          aria-haspopup="dialog"
          aria-label={`Ver detalle de ${titulo}`}
          onClick={() => setDetalle(true)}
        >
          {cuerpo}
        </button>
      )}
      {detalle && (
        <DetalleFlujo
          fila={fila}
          envasados={envasados}
          nombres={nombres}
          habilitado={habilitado}
          cargadoEn={cargadoEn}
          volverA={disparador}
          onAccion={onAccion}
          onControlar={enControl ? yDespues(() => setControlando(true)) : undefined}
          onCargarEnvasado={yDespues(onCargarEnvasado)}
          onEditar={editable ? yDespues(onEditar) : undefined}
          onCerrar={() => setDetalle(false)}
        />
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
    </motion.article>
  )
}
