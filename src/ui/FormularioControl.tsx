import { useState } from 'react'
import { FORM_CONTROL_VACIO, hayNoOk, validarControl, type FormControl } from '../domain/control'
import type { Resultado } from '../lib/acciones'
import './FormularioControl.css'

type Accion = 'aprobar' | 'rechazar'

function MensajeError({ texto }: { texto?: string }) {
  return texto ? <p className="fc-error">{texto}</p> : null
}

function Ok({ nombre, valor, onChange }: { nombre: string; valor: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="fc-ok" role="group" aria-label={nombre}>
      <button type="button" className="fc-ok-boton" aria-pressed={valor === true} onClick={() => onChange(true)}>
        OK
      </button>
      <button type="button" className="fc-ok-boton fc-no" aria-pressed={valor === false} onClick={() => onChange(false)}>
        No OK
      </button>
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

  const errores = intentado ? validarControl(f, esPolvo) : {}
  const set = <K extends keyof FormControl>(k: K, v: FormControl[K]) => setF((x) => ({ ...x, [k]: v }))

  function pedir(accion: Accion) {
    setIntentado(true)
    setErrorServidor(null)
    if (Object.keys(validarControl(f, esPolvo)).length > 0) return
    setConfirmando(accion)
  }

  async function confirmar() {
    if (!confirmando) return
    setPendiente(true)
    try {
      const r = await (confirmando === 'aprobar' ? onAprobar(f) : onRechazar(f))
      if (!r.ok) {
        setErrorServidor(r.texto)
        setConfirmando(null)
      }
    } finally {
      setPendiente(false)
    }
  }

  return (
    <div className="fc" role="form" aria-label="Control">
      <h2 className="fc-titulo">
        Control — Intento {intento}
        {producto ? <span className="fc-producto">{producto}</span> : null}
      </h2>

      {confirmando === null ? (
        <>
          {!esPolvo && (
            <>
              <label className="fc-campo">
                <span className="fc-etiqueta">pH</span>
                <input
                  className="fc-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={f.ph}
                  onChange={(e) => set('ph', e.target.value)}
                />
                <MensajeError texto={errores.ph} />
              </label>
              <label className="fc-campo">
                <span className="fc-etiqueta">Densidad</span>
                <input
                  className="fc-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={f.densidad}
                  onChange={(e) => set('densidad', e.target.value)}
                />
                <MensajeError texto={errores.densidad} />
              </label>
            </>
          )}

          <div className="fc-campo">
            <span className="fc-etiqueta">Perfume</span>
            <Ok nombre="Perfume" valor={f.perfumeOk} onChange={(v) => set('perfumeOk', v)} />
            <MensajeError texto={errores.perfumeOk} />
            {f.perfumeOk === false && (
              <label className="fc-campo">
                <span className="fc-etiqueta">¿Qué está mal?</span>
                <textarea className="fc-texto" value={f.perfumeComentario} onChange={(e) => set('perfumeComentario', e.target.value)} />
                <MensajeError texto={errores.perfumeComentario} />
              </label>
            )}
          </div>

          <div className="fc-campo">
            <span className="fc-etiqueta">Visual</span>
            <Ok nombre="Visual" valor={f.visualOk} onChange={(v) => set('visualOk', v)} />
            <MensajeError texto={errores.visualOk} />
            {f.visualOk === false && (
              <label className="fc-campo">
                <span className="fc-etiqueta">¿Qué está mal?</span>
                <textarea className="fc-texto" value={f.visualComentario} onChange={(e) => set('visualComentario', e.target.value)} />
                <MensajeError texto={errores.visualComentario} />
              </label>
            )}
          </div>

          <label className="fc-campo">
            <span className="fc-etiqueta">Observaciones (opcional)</span>
            <textarea className="fc-texto" value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} />
          </label>

          {errorServidor && (
            <p className="fc-error" role="alert">
              {errorServidor}
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
        <>
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
        </>
      )}
    </div>
  )
}
