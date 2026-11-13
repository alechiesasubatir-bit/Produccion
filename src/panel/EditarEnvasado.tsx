import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { cargarDatosOrden, cargarEnvasadoEdicion, editarEnvasado, type DatosOrden, type EnvasadoEditable } from './datosOrden'

// Edita un envasado ya creado. El tanque solo se cambia mientras está en cola;
// «soloTanque» es la variante de «Asignar tanque» para los que esperan fabricación.
export function EditarEnvasado({
  id,
  soloTanque = false,
  onCerrar,
  onGuardado,
}: {
  id: string
  soloTanque?: boolean
  onCerrar: () => void
  onGuardado: () => void
}) {
  const dialogo = useRef<HTMLDivElement>(null)
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

  const [datos, setDatos] = useState<DatosOrden | null>(null)
  const [env, setEnv] = useState<EnvasadoEditable | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [presentacion, setPresentacion] = useState('')
  const [fabricacion, setFabricacion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    Promise.all([cargarDatosOrden(), cargarEnvasadoEdicion(id)]).then(
      ([d, e]) => {
        if (!vivo) return
        if (!e) return setError('No se encontró el envasado.')
        setDatos(d)
        setEnv(e)
        setCantidad(String(e.cantidad))
        setPresentacion(e.presentacion_id)
        setFabricacion(e.fabricacion_id ?? '')
      },
      () => vivo && setError('No se pudo cargar el envasado.'),
    )
    return () => {
      vivo = false
    }
  }, [id])

  const abiertas = datos?.fabricacionesAbiertas ?? []
  const granel = env ? (abiertas.find((f) => f.id === env.fabricacion_id)?.producto_id ?? env.granel_id) : null
  const opciones = abiertas.filter((f) => !granel || f.producto_id === granel)
  const tanqueHabilitado = !!env && (soloTanque || env.estado === 'cola')
  const codigo = (tanqueId: string) => datos?.tanques.find((t) => t.tanque_id === tanqueId)?.codigo ?? 'Tanque'

  const guardar = async (e: FormEvent) => {
    e.preventDefault()
    if (!env || guardando) return
    const cambios: Parameters<typeof editarEnvasado>[1] = {}
    if (!soloTanque) {
      const n = Number(cantidad)
      if (!Number.isInteger(n) || n <= 0) return setError('La cantidad tiene que ser un número entero mayor a 0.')
      if (n !== env.cantidad) cambios.cantidad = n
      if (presentacion && presentacion !== env.presentacion_id) cambios.presentacion_id = presentacion
    }
    if (tanqueHabilitado && fabricacion && fabricacion !== (env.fabricacion_id ?? '')) cambios.fabricacion_id = fabricacion
    if (soloTanque && !cambios.fabricacion_id) return setError('Elegí un tanque.')
    if (Object.keys(cambios).length === 0) return onCerrar()
    setGuardando(true)
    setError(null)
    const r = await editarEnvasado(id, cambios)
    setGuardando(false)
    if (r.ok) onGuardado()
    else setError(r.texto)
  }

  return createPortal(
    <div className="modal-fondo" onClick={onCerrar}>
      <div
        ref={dialogo}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={soloTanque ? 'Asignar tanque' : 'Editar envasado'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-cabecera">
          <h2>{soloTanque ? 'Asignar tanque' : 'Editar envasado'}</h2>
        </header>
        <form className="formulario" onSubmit={(e) => void guardar(e)}>
          {!soloTanque && (
            <>
              <div className="campo">
                <label htmlFor="ee-cantidad">Cantidad</label>
                <input id="ee-cantidad" type="number" min={1} step={1} value={cantidad} disabled={!env} onChange={(e) => setCantidad(e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="ee-presentacion">Presentación</label>
                <select id="ee-presentacion" value={presentacion} disabled={!env} onChange={(e) => setPresentacion(e.target.value)}>
                  {(datos?.presentaciones ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="campo">
            <label htmlFor="ee-tanque">Tanque</label>
            <select id="ee-tanque" value={fabricacion} disabled={!tanqueHabilitado} onChange={(e) => setFabricacion(e.target.value)}>
              <option value="">{env?.fabricacion_id ? 'Sin cambios' : 'Elegí un tanque'}</option>
              {opciones.map((f) => (
                <option key={f.id} value={f.id}>
                  {`${codigo(f.tanque_id)}${f.lote ? ` · Lote ${f.lote}` : ''} · ${f.sinAsignar} L libres`}
                </option>
              ))}
            </select>
            {env && !tanqueHabilitado && <span className="campo-error">El tanque solo se cambia mientras el envasado está en cola.</span>}
          </div>
          {error && (
            <p className="aviso-panel" role="alert">
              {error}
            </p>
          )}
          <div className="modal-pie">
            <button type="button" className="boton boton-sec" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="boton" disabled={!env || guardando}>
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
