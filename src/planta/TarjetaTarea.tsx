import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { accionesPosibles, type Accion } from '../domain/acciones'
import { nivelTanque, type EstadoTanque } from '../domain/tanque'
import { esUltima, etiquetaAccion, formatoCronometro, segundosTranscurridos, tituloTarea, type Tarea } from '../domain/tareas'
import { setVencimiento } from '../lib/acciones'
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

const fechaAr = (iso: string) => iso.split('-').reverse().join('/')

function Vencimiento({ fabricacionId, vencimiento, empleadoId, habilitado }: { fabricacionId: string; vencimiento: string | null; empleadoId?: string; habilitado: boolean }) {
  const [editando, setEditando] = useState(false)
  const [fecha, setFecha] = useState(vencimiento ?? '')
  // Valor recién guardado: vale hasta que Realtime traiga uno distinto del que había.
  const [local, setLocal] = useState<{ base: string | null; fecha: string } | null>(null)
  const valor = local && local.base === vencimiento ? local.fecha : vencimiento
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const guardar = async () => {
    if (!fecha || guardando) return
    setGuardando(true)
    const r = await setVencimiento({ fabricacionId, fecha, empleadoId })
    setGuardando(false)
    if (!r.ok) return setError(r.texto)
    setError(null)
    setLocal({ base: vencimiento, fecha })
    setEditando(false)
  }
  if (editando)
    return (
      <div className="tarea-vencimiento">
        <input type="date" aria-label="Fecha de vencimiento" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <button type="button" className="boton" disabled={!habilitado || !fecha || guardando} onClick={() => void guardar()}>
          Guardar
        </button>
        <button type="button" className="boton boton-sec" onClick={() => { setEditando(false); setError(null) }}>
          Cancelar
        </button>
        {error && <p className="aviso-planta" role="alert">{error}</p>}
      </div>
    )
  const abrir = () => { setFecha(valor ?? ''); setEditando(true) }
  return (
    <div className="tarea-vencimiento">
      {valor ? (
        <>
          <span>Vence: {fechaAr(valor)}</span>
          <button type="button" className="boton boton-sec" aria-label="Cambiar vencimiento" disabled={!habilitado} onClick={abrir}>
            ✎
          </button>
        </>
      ) : (
        <button type="button" className="boton boton-sec" disabled={!habilitado} onClick={abrir}>
          Cargar vencimiento
        </button>
      )}
    </div>
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
  onControlar,
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
  // Fabricación en control: la única acción es Controlar.
  onControlar?: () => void
}) {
  const enControl = tarea.estado === 'en_control'
  const propia = !disponible && !enCurso && !enControl
  const ultima = propia && !!empleadoId && esUltima(tarea, empleadoId)
  const acciones: Accion[] = enControl
    ? []
    : disponible
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
          {enControl && tarea.control_intento !== null && <span className="tarea-intento">Intento {tarea.control_intento}</span>}
          {otras.length > 0 && <span className="tarea-con">Con: {otras.join(' · ')}</span>}
        </span>
      </div>
      {tarea.control_rechazo && <span className="tarea-rechazo">Rechazado: {tarea.control_rechazo}</span>}
      {!enControl && <Cronometro tarea={tarea} cargadoEn={cargadoEn} />}
      {tarea.entidad !== 'fabricacion' && (
        <span className="tarea-etiqueta">{tarea.etiqueta ? `Etiqueta: ${tarea.etiqueta}` : 'Sin etiquetar'}</span>
      )}
      {propia && tarea.entidad === 'fabricacion' && (
        <Vencimiento fabricacionId={tarea.id} vencimiento={tarea.vencimiento} empleadoId={empleadoId} habilitado={habilitado} />
      )}
      <div className="tarea-acciones">
        {enControl && (
          <button type="button" className="accion accion-controlar" disabled={!habilitado} onClick={onControlar}>
            Controlar
          </button>
        )}
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
