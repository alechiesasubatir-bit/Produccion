import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { accionesPosibles, type Accion } from '../domain/acciones'
import { nivelTanque, type EstadoTanque } from '../domain/tanque'
import { esUltima, etiquetaAccion, formatoCronometro, segundosTranscurridos, tituloTarea, type Tarea } from '../domain/tareas'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'

// Estado de tanque equivalente para el mini-tanque de la tarjeta.
function estadoMiniTanque(t: Tarea): EstadoTanque {
  if (t.entidad === 'fabricacion') return t.estado as EstadoTanque
  if (t.estado === 'activo') return 'envasando'
  if (t.estado === 'pausado') return 'env_pausado'
  return 'cola_env'
}

const estaEnCurso = (t: Tarea) => ['fabricando', 'pausada', 'activo', 'pausado'].includes(t.estado)

export function Cronometro({ tarea, cargadoEn }: { tarea: Pick<Tarea, 'min_efectivos' | 'corriendo'>; cargadoEn: number }) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    if (!tarea.corriendo) return
    const id = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(id)
  }, [tarea.corriendo])
  if (tarea.min_efectivos === null && !tarea.corriendo) return null
  return (
    <span className="cronometro" role="timer">
      {formatoCronometro(segundosTranscurridos(tarea, cargadoEn, ahora))}
    </span>
  )
}

export function TarjetaTarea({
  tarea,
  disponible,
  habilitado,
  cargadoEn,
  onAccion,
  checklist,
  bloqueoFinalizar,
  enCurso = false,
  empleadoId,
}: {
  tarea: Tarea
  disponible: boolean
  habilitado: boolean
  cargadoEn: number
  onAccion: (a: Accion) => void
  // Checklist de materias primas (solo fabricaciones propias en curso con MP).
  checklist?: ReactNode
  // Si viene, Finalizar queda deshabilitado y se muestra este motivo.
  bloqueoFinalizar?: string | null
  // Orden en curso de otras: la única acción es sumarse.
  enCurso?: boolean
  // Operaria de la sesión: para «Con: …» y para saber si es la última.
  empleadoId?: string
}) {
  const propia = !disponible && !enCurso
  const ultima = propia && !!empleadoId && esUltima(tarea, empleadoId)
  const acciones: Accion[] = disponible
    ? ['iniciar']
    : enCurso
      ? ['sumarse']
      : [...accionesPosibles(tarea.entidad, tarea.estado, 'planta'), ...(estaEnCurso(tarea) ? (['salir'] as Accion[]) : [])]
  const otras = (tarea.operarias ?? []).filter((o) => o.empleado_id !== empleadoId).map((o) => o.nombre)
  const idUltima = useId()
  const estado = estadoMiniTanque(tarea)
  const idBloqueo = useId()

  return (
    <article
      className="tarjeta-tarea"
      aria-label={tituloTarea(tarea)}
      style={{ '--producto': tarea.color ?? undefined } as CSSProperties}
    >
      {tarea.tanque_codigo && (
        <Tanque
          estado={estado}
          color={tarea.color ?? undefined}
          tipo={tarea.producto_tipo}
          ancho={44}
          nivel={nivelTanque({ estado, capacidad: 1, litros: 1, litrosRestantes: 1, progresoFab: 0.6 })}
          etiqueta={`Tanque ${tarea.tanque_codigo}`}
        />
      )}
      <div className="tarea-info">
        <span className="tarea-titulo">{tituloTarea(tarea)}</span>
        <span className="tarea-meta">
          {tarea.tanque_codigo && <span className="tarea-tanque">{tarea.tanque_codigo}</span>}
          <Chip estado={tarea.entidad === 'fraccionado' && tarea.estado === 'activo' ? 'fraccionado' : tarea.estado} />
          {tarea.lote && <span className="tarea-lote">Lote {tarea.lote}</span>}
          {otras.length > 0 && <span className="tarea-con">Con: {otras.join(' · ')}</span>}
        </span>
      </div>
      <Cronometro tarea={tarea} cargadoEn={cargadoEn} />
      <div className="tarea-acciones">
        {acciones.map((a) => {
          const salirUltima = a === 'salir' && ultima
          const bloqueada = (a === 'finalizar' && !!bloqueoFinalizar) || salirUltima
          return (
            <button
              key={a}
              type="button"
              className={`accion accion-${a}`}
              disabled={!habilitado || bloqueada}
              aria-describedby={salirUltima ? idUltima : bloqueada ? idBloqueo : undefined}
              onClick={() => onAccion(a)}
            >
              {etiquetaAccion(a, disponible)}
            </button>
          )
        })}
        {ultima && acciones.includes('salir') && (
          <span id={idUltima} className="bloqueo-finalizar">
            Sos la última: pausá o finalizá
          </span>
        )}
        {bloqueoFinalizar && acciones.includes('finalizar') && (
          <span id={idBloqueo} className="bloqueo-finalizar">
            {bloqueoFinalizar}
          </span>
        )}
      </div>
      {checklist && <div className="tarea-checklist">{checklist}</div>}
    </article>
  )
}
