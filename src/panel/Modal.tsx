import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// Diálogo modal del panel: va al body, toma el foco al abrirse y lo devuelve al cerrarse,
// se cierra con Escape o con un click en el fondo.
// `titulo` pone la cabecera (con × salvo `sinCerrar`); `etiqueta` fija el nombre accesible
// cuando no hay cabecera o tiene que ser otro que el título. `volverA`: a quién devolver el foco
// (por defecto, lo que lo tenía al abrir; Safari no enfoca los botones al hacer click).
export function Modal({
  titulo,
  etiqueta,
  sinCerrar = false,
  clase,
  volverA,
  onCerrar,
  children,
}: {
  titulo?: string
  etiqueta?: string
  sinCerrar?: boolean
  clase?: string
  volverA?: RefObject<HTMLElement | null>
  onCerrar: () => void
  children: ReactNode
}) {
  const id = useId()
  const dialogo = useRef<HTMLDivElement>(null)
  // Ref: un onCerrar nuevo en cada render no tiene que volver a mover el foco.
  const cerrar = useRef(onCerrar)
  cerrar.current = onCerrar
  useEffect(() => {
    const boton = volverA?.current ?? (document.activeElement as HTMLElement | null)
    dialogo.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && cerrar.current()
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      boton?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir y cerrar
  }, [])

  return createPortal(
    <div className="modal-fondo" onClick={onCerrar}>
      <div
        ref={dialogo}
        tabIndex={-1}
        className={clase ? `modal ${clase}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={etiqueta}
        aria-labelledby={etiqueta === undefined && titulo !== undefined ? id : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {titulo !== undefined && (
          <header className="modal-cabecera">
            <h2 id={id}>{titulo}</h2>
            {!sinCerrar && (
              <button type="button" className="boton boton-sec" onClick={onCerrar} aria-label="Cerrar">
                ×
              </button>
            )}
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
