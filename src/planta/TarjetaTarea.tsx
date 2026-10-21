import { useEffect, useState } from 'react'
import { accionesPosibles, type Accion } from '../domain/acciones'
import { nivelTanque, type EstadoTanque } from '../domain/tanque'
import { etiquetaAccion, formatoCronometro, segundosTranscurridos, tituloTarea, type Tarea } from '../domain/tareas'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'

// Estado de tanque equivalente para el mini-tanque de la tarjeta.
function estadoMiniTanque(t: Tarea): EstadoTanque {
  if (t.entidad === 'fabricacion') return t.estado as EstadoTanque
  if (t.estado === 'activo') return 'envasando'
  if (t.estado === 'pausado') return 'env_pausado'
  return 'cola_env'
}

function Cronometro({ tarea, cargadoEn }: { tarea: Tarea; cargadoEn: number }) {
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
}: {
  tarea: Tarea
  disponible: boolean
  habilitado: boolean
  cargadoEn: number
  onAccion: (a: Accion) => void
}) {
  const acciones: Accion[] = disponible ? ['iniciar'] : accionesPosibles(tarea.entidad, tarea.estado, 'planta')
  const estado = estadoMiniTanque(tarea)

  return (
    <article className="tarjeta-tarea" aria-label={tituloTarea(tarea)}>
      {tarea.tanque_codigo && (
        <Tanque
          estado={estado}
          color={tarea.color ?? undefined}
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
        </span>
      </div>
      <Cronometro tarea={tarea} cargadoEn={cargadoEn} />
      <div className="tarea-acciones">
        {acciones.map((a) => (
          <button
            key={a}
            type="button"
            className={`accion accion-${a}`}
            disabled={!habilitado}
            onClick={() => onAccion(a)}
          >
            {etiquetaAccion(a, disponible)}
          </button>
        ))}
      </div>
    </article>
  )
}
