import { motion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { accionesPosibles, type Accion } from '../domain/acciones'
import type { FilaFlujo } from '../domain/flujo'
import { nivelTanque, type EstadoTanque } from '../domain/tanque'
import { etiquetaAccion, tituloTarea } from '../domain/tareas'
import { Cronometro } from '../planta/TarjetaTarea'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'

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
  onAccion,
}: {
  fila: FilaFlujo
  nombres: Map<string, string>
  habilitado: boolean
  cargadoEn: number
  /** Minutos estimados por la velocidad histórica (null si no hay historial). */
  proyeccionMin?: number | null
  onAccion: (a: Accion) => void
}) {
  const [confirmando, setConfirmando] = useState<Accion | null>(null)
  const acciones = accionesPosibles(fila.entidad, fila.estado, 'panel')
  const operarias = [fila.operaria_1, fila.operaria_2]
    .filter((id): id is string => !!id)
    .map((id) => nombres.get(id) ?? 'Operaria')
  const estado = estadoMini(fila)
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
        {fila.tanque_codigo && <Tanque estado={estado} color={fila.color ?? undefined} nivel={nivel} ancho={28} />}
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
      {acciones.length > 0 && (
        <div className="tf-acciones">
          {acciones.map((a) => (
            <button
              key={a}
              type="button"
              className={`boton-mini${confirmando === a ? ' confirmar' : ''}`}
              disabled={!habilitado}
              onClick={() => tocar(a)}
            >
              {confirmando === a ? '¿Seguro?' : etiquetaAccion(a, false)}
            </button>
          ))}
        </div>
      )}
    </motion.article>
  )
}
