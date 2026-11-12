import { useEffect, useState } from 'react'
import { mensajeError } from '../lib/errores'
import { listarLiberadoras } from '../lib/acciones'

// Paso previo al formulario de control: quién firma el control (solo las que pueden liberar).
export function QuienControla({ onElegir, onCancelar }: { onElegir: (id: string) => void; onCancelar: () => void }) {
  const [liberadoras, setLiberadoras] = useState<{ id: string; nombre: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    listarLiberadoras().then(
      (l) => vivo && setLiberadoras(l),
      (e) => vivo && setError(mensajeError(e).texto),
    )
    return () => {
      vivo = false
    }
  }, [])

  return (
    <section className="quien" role="dialog" aria-label="¿Quién controla?">
      <h1 className="titulo-planta">¿Quién controla?</h1>
      {error && (
        <p className="aviso-planta" role="alert">
          {error}
        </p>
      )}
      {liberadoras === null && !error && <p className="vacio">Cargando…</p>}
      {liberadoras?.length === 0 && <p className="vacio">No hay nadie habilitada para controlar. Avisá a la encargada.</p>}
      <div className="quien-grilla">
        {liberadoras?.map((l) => (
          <button key={l.id} type="button" className="quien-boton" onClick={() => onElegir(l.id)}>
            <span className="quien-nombre">{l.nombre}</span>
          </button>
        ))}
      </div>
      <button type="button" className="boton boton-sec" onClick={onCancelar}>
        Volver
      </button>
    </section>
  )
}
