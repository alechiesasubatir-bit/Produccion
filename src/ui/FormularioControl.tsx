import { useEffect, useRef, useState } from 'react'
import { FORM_CONTROL_VACIO, hayNoOk, validarControl, type FormControl } from '../domain/control'
import type { Resultado } from '../lib/acciones'
import './FormularioControl.css'

type Accion = 'aprobar' | 'rechazar'

function MensajeError({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <p className="fc-error" id={id}>
      {texto}
    </p>
  ) : null
}

const desc = (id: string, texto?: string) => (texto ? { 'aria-describedby': id, 'aria-invalid': true as const } : {})

function Ok({
  nombre,
  valor,
  onChange,
  errorId,
}: {
  nombre: string
  valor: boolean | null
  onChange: (v: boolean) => void
  errorId?: string
}) {
  return (
    <div className="fc-ok" role="group" aria-label={nombre} aria-describedby={errorId}>
      <button type="button" className="fc-ok-boton" aria-pressed={valor === true} onClick={() => onChange(true)}>
        OK
      </button>
      <button type="button" className="fc-ok-boton fc-no" aria-pressed={valor === false} onClick={() => onChange(false)}>
        No OK
      </button>
    </div>
  )
}

function Comentario({
  id,
  valor,
  onChange,
  error,
}: {
  id: string
  valor: string
  onChange: (v: string) => void
  error?: string
}) {
  return (
    <div className="fc-campo">
      <label className="fc-etiqueta" htmlFor={id}>
        ¿Qué está mal?
      </label>
      <textarea id={id} className="fc-texto" value={valor} onChange={(e) => onChange(e.target.value)} {...desc(`${id}-error`, error)} />
      <MensajeError id={`${id}-error`} texto={error} />
    </div>
  )
}

function Numero({
  id,
  etiqueta,
  valor,
  onChange,
  error,
}: {
  id: string
  etiqueta: string
  valor: string
  onChange: (v: string) => void
  error?: string
}) {
  return (
    <div className="fc-campo">
      <label className="fc-etiqueta" htmlFor={id}>
        {etiqueta}
      </label>
      <input
        id={id}
        className="fc-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        {...desc(`${id}-error`, error)}
      />
      <MensajeError id={`${id}-error`} texto={error} />
    </div>
  )
}

// Formulario de control para liberación: lo comparten la tablet y el panel. Los padres convierten a número.
export function FormularioControl({
  esPolvo,
  intento,
  producto,
  onAprobar,
  onRechazar,
  onCancelar,
}: {
  esPolvo: boolean
  intento: number
  producto?: string
  onAprobar: (f: FormControl) => Promise<Resultado>
  onRechazar: (f: FormControl) => Promise<Resultado>
  onCancelar: () => void
}) {
  const [f, setF] = useState<FormControl>(FORM_CONTROL_VACIO)
  const [intentado, setIntentado] = useState(false)
  const [confirmando, setConfirmando] = useState<Accion | null>(null)
  const [pendiente, setPendiente] = useState(false)
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [bloqueado, setBloqueado] = useState(false)
  const enCurso = useRef(false)
  const titulo = useRef<HTMLHeadingElement>(null)
  const confirmacion = useRef<HTMLDivElement>(null)
  const alerta = useRef<HTMLParagraphElement>(null)
  const estuvoConfirmando = useRef(false)

  // Foco: a la confirmación al abrirla; al alert (o al título) al volver.
  useEffect(() => {
    if (confirmando !== null) {
      estuvoConfirmando.current = true
      confirmacion.current?.focus()
    } else if (estuvoConfirmando.current) {
      estuvoConfirmando.current = false
      const destino = alerta.current ?? titulo.current
      destino?.focus()
    }
  }, [confirmando])

  const errores = intentado ? validarControl(f, esPolvo) : {}
  const alertaTexto = errorServidor ?? (bloqueado && Object.keys(errores).length > 0 ? 'Revisá los campos marcados.' : null)
  const set = <K extends keyof FormControl>(k: K, v: FormControl[K]) => setF((x) => ({ ...x, [k]: v }))

  function pedir(accion: Accion) {
    setIntentado(true)
    setErrorServidor(null)
    if (Object.keys(validarControl(f, esPolvo)).length > 0) {
      setBloqueado(true)
      return
    }
    setBloqueado(false)
    setConfirmando(accion)
  }

  async function confirmar() {
    if (!confirmando || enCurso.current) return
    enCurso.current = true
    setPendiente(true)
    try {
      const r = await (confirmando === 'aprobar' ? onAprobar(f) : onRechazar(f))
      if (!r.ok) {
        setErrorServidor(r.texto)
        setConfirmando(null)
      }
    } catch {
      setErrorServidor('No se pudo guardar. Probá de nuevo.')
      setConfirmando(null)
    } finally {
      enCurso.current = false
      setPendiente(false)
    }
  }

  return (
    <div className="fc" role="form" aria-label="Control">
      <h2 className="fc-titulo" ref={titulo} tabIndex={-1}>
        Control — Intento {intento}
        {producto ? <span className="fc-producto">{producto}</span> : null}
      </h2>

      {confirmando === null ? (
        <>
          {!esPolvo && (
            <>
              <Numero id="fc-ph" etiqueta="pH" valor={f.ph} onChange={(v) => set('ph', v)} error={errores.ph} />
              <Numero id="fc-densidad" etiqueta="Densidad" valor={f.densidad} onChange={(v) => set('densidad', v)} error={errores.densidad} />
            </>
          )}

          <div className="fc-campo">
            <span className="fc-etiqueta">Perfume</span>
            <Ok
              nombre="Perfume"
              valor={f.perfumeOk}
              onChange={(v) => set('perfumeOk', v)}
              errorId={errores.perfumeOk ? 'fc-perfume-ok-error' : undefined}
            />
            <MensajeError id="fc-perfume-ok-error" texto={errores.perfumeOk} />
            {f.perfumeOk === false && (
              <Comentario id="fc-perfume-comentario" valor={f.perfumeComentario} onChange={(v) => set('perfumeComentario', v)} error={errores.perfumeComentario} />
            )}
          </div>

          <div className="fc-campo">
            <span className="fc-etiqueta">Visual</span>
            <Ok
              nombre="Visual"
              valor={f.visualOk}
              onChange={(v) => set('visualOk', v)}
              errorId={errores.visualOk ? 'fc-visual-ok-error' : undefined}
            />
            <MensajeError id="fc-visual-ok-error" texto={errores.visualOk} />
            {f.visualOk === false && (
              <Comentario id="fc-visual-comentario" valor={f.visualComentario} onChange={(v) => set('visualComentario', v)} error={errores.visualComentario} />
            )}
          </div>

          <div className="fc-campo">
            <label className="fc-etiqueta" htmlFor="fc-observaciones">
              Observaciones (opcional)
            </label>
            <textarea id="fc-observaciones" className="fc-texto" value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} />
          </div>

          {alertaTexto && (
            <p className="fc-error" role="alert" ref={alerta} tabIndex={-1}>
              {alertaTexto}
            </p>
          )}

          <div className="fc-acciones">
            <button type="button" className="boton" disabled={pendiente} onClick={() => pedir('aprobar')}>
              Aprobar
            </button>
            <button type="button" className="boton" disabled={pendiente} onClick={() => pedir('rechazar')}>
              Rechazar
            </button>
            <button type="button" className="boton boton-sec" disabled={pendiente} onClick={onCancelar}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <div ref={confirmacion} tabIndex={-1} className="fc-confirmacion">
          {confirmando === 'aprobar' ? (
            <>
              <p className="fc-confirmar">¿Aprobar el control? El tanque queda listo para envasar.</p>
              {hayNoOk(f) && <p className="fc-confirmar">Hay puntos No OK. ¿Aprobar igual?</p>}
            </>
          ) : (
            <p className="fc-confirmar">La fabricación vuelve a fabricando.</p>
          )}
          <div className="fc-acciones">
            <button type="button" className="boton" disabled={pendiente} onClick={confirmar}>
              {confirmando === 'aprobar' ? 'Sí, aprobar' : 'Sí, rechazar'}
            </button>
            <button type="button" className="boton boton-sec" disabled={pendiente} onClick={() => setConfirmando(null)}>
              Volver
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
