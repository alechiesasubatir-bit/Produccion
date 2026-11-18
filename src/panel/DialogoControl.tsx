import { parsearPh, type FormControl } from '../domain/control'
import { parsearCantidad } from '../domain/tareas'
import { registrarControl } from '../lib/acciones'
import { FormularioControl } from '../ui/FormularioControl'
import { Modal } from './Modal'

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

  return (
    <Modal etiqueta="Control para liberación" onCerrar={onCerrar}>
      <FormularioControl
        esPolvo={esPolvo}
        intento={intento}
        producto={producto}
        onAprobar={(f) => controlar(f, 'aprobado')}
        onRechazar={(f) => controlar(f, 'rechazado')}
        onCancelar={onCerrar}
      />
    </Modal>
  )
}
