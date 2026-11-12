import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { parsearPh, type FormControl } from '../domain/control'
import { parsearCantidad } from '../domain/tareas'
import { registrarControl } from '../lib/acciones'
import { FormularioControl } from '../ui/FormularioControl'

// Control para liberación desde el panel: firma el usuario logueado (sin «¿Quién controla?»).
export function DialogoControl({
  fabricacionId,
  esPolvo,
  intento,
  producto,
  onCerrar,
}: {
  fabricacionId: string
  esPolvo: boolean
  intento: number
  producto?: string
  onCerrar: () => void
}) {
  const dialogo = useRef<HTMLDivElement>(null)
  // Ref: un onCerrar nuevo en cada render no tiene que volver a mover el foco.
  const cerrar = useRef(onCerrar)
  cerrar.current = onCerrar
  useEffect(() => {
    const boton = document.activeElement as HTMLElement | null
    dialogo.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && cerrar.current()
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      boton?.focus()
    }
  }, [])

  const controlar = async (f: FormControl, resultado: 'aprobado' | 'rechazado') => {
    const r = await registrarControl({
      fabricacionId,
      ph: f.ph.trim() === '' ? null : parsearPh(f.ph),
      densidad: f.densidad.trim() === '' ? null : parsearCantidad(f.densidad),
      perfumeOk: f.perfumeOk === true,
      perfumeComentario: f.perfumeComentario,
      visualOk: f.visualOk === true,
      visualComentario: f.visualComentario,
      observaciones: f.observaciones,
      resultado,
    })
    if (r.ok) onCerrar()
    return r
  }

  return createPortal(
    <div className="modal-fondo" onClick={onCerrar}>
      <div
        ref={dialogo}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Control para liberación"
        onClick={(e) => e.stopPropagation()}
      >
        <FormularioControl
          esPolvo={esPolvo}
          intento={intento}
          producto={producto}
          onAprobar={(f) => controlar(f, 'aprobado')}
          onRechazar={(f) => controlar(f, 'rechazado')}
          onCancelar={onCerrar}
        />
      </div>
    </div>,
    document.body,
  )
}
