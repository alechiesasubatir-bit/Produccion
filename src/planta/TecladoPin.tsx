import { useEffect, useState } from 'react'

const LARGO = 4
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function TecladoPin({
  nombre,
  error,
  ocupado,
  onCompleto,
  onVolver,
}: {
  nombre: string
  error: string | null
  ocupado: boolean
  onCompleto: (pin: string) => void
  onVolver: () => void
}) {
  const [digitos, setDigitos] = useState('')
  const [sacudir, setSacudir] = useState(false)

  // Un error nuevo vacía el teclado y sacude los puntos.
  useEffect(() => {
    if (!error) return
    setDigitos('')
    setSacudir(true)
    const id = setTimeout(() => setSacudir(false), 450)
    return () => clearTimeout(id)
  }, [error])

  const agregar = (d: string) => {
    if (ocupado || digitos.length >= LARGO) return
    const nuevo = digitos + d
    if (nuevo.length === LARGO) {
      setDigitos('')
      onCompleto(nuevo)
    } else {
      setDigitos(nuevo)
    }
  }
  const borrar = () => setDigitos((p) => p.slice(0, -1))

  // Teclado físico (útil en PC y para pruebas).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) agregar(e.key)
      else if (e.key === 'Backspace') borrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  const llenos = ocupado ? LARGO : digitos.length

  return (
    <section className="pin">
      <p className="pin-hola">Hola,</p>
      <h1 className="titulo-planta">{nombre}</h1>
      <p className="pin-ayuda">Ingresá tu PIN</p>
      <div className={`pin-puntos${sacudir ? ' sacudir' : ''}`} aria-label={`${llenos} de ${LARGO} dígitos`}>
        {Array.from({ length: LARGO }, (_, i) => (
          <span key={i} className={`pin-punto${i < llenos ? ' lleno' : ''}`} />
        ))}
      </div>
      <p className="pin-error" role="alert">
        {error ?? ''}
      </p>
      <div className="pin-teclas">
        {TECLAS.map((d) => (
          <button key={d} type="button" className="pin-tecla" onClick={() => agregar(d)} disabled={ocupado}>
            {d}
          </button>
        ))}
        <button type="button" className="pin-tecla pin-tecla-sec" onClick={borrar} disabled={ocupado}>
          Borrar
        </button>
        <button type="button" className="pin-tecla" onClick={() => agregar('0')} disabled={ocupado}>
          0
        </button>
        <button type="button" className="pin-tecla pin-tecla-sec" onClick={onVolver}>
          Volver
        </button>
      </div>
    </section>
  )
}
