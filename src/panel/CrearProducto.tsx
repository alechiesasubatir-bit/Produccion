import { useId, useState } from 'react'
import { crearProducto, type ProductoOrden, type TipoProducto } from './datosOrden'

const TIPOS: Array<[TipoProducto, string]> = [
  ['liquido', 'Líquido'],
  ['denso', 'Denso'],
  ['polvo', 'Polvo'],
]

// En la tarjeta de un PDF cuyo producto no está en el catálogo: lo da de alta con el nombre del PDF
// (editable) y la tarjeta lo toma. Si en realidad existe con otro nombre, se elige en la lista de arriba.
export function CrearProducto({
  nombre,
  tipo,
  codigo = null,
  deshabilitado = false,
  onCreado,
}: {
  nombre: string
  tipo: TipoProducto
  /** Código F del granel: el producto nuevo ya queda con él. */
  codigo?: string | null
  deshabilitado?: boolean
  onCreado: (p: ProductoOrden) => void
}) {
  const id = useId()
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState({ nombre, tipo })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!abierto) {
    return (
      <button type="button" className="boton-mini" disabled={deshabilitado} onClick={() => setAbierto(true)}>
        Crear producto nuevo
      </button>
    )
  }

  const crear = async () => {
    const n = valor.nombre.trim()
    if (!n) return setError('Poné el nombre del producto.')
    setGuardando(true)
    setError(null)
    const r = await crearProducto({ nombre: n, tipo: valor.tipo, codigo })
    setGuardando(false)
    if (!r.ok) {
      setError(r.codigo === 'NOMBRE_DUPLICADO' ? 'Ya hay un producto con ese nombre: elegilo en la lista.' : r.texto)
      return
    }
    setAbierto(false)
    onCreado(r.producto)
  }

  return (
    <fieldset className="crear-producto" disabled={deshabilitado || guardando} aria-label="Producto nuevo">
      <div className="campo">
        <label htmlFor={`${id}-nombre`}>Nombre del producto nuevo</label>
        <input id={`${id}-nombre`} value={valor.nombre} onChange={(e) => setValor((v) => ({ ...v, nombre: e.target.value }))} />
      </div>
      <div className="campo">
        <label htmlFor={`${id}-tipo`}>Tipo</label>
        <select id={`${id}-tipo`} value={valor.tipo} onChange={(e) => setValor((v) => ({ ...v, tipo: e.target.value as TipoProducto }))}>
          {TIPOS.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {error && <span className="campo-error">{error}</span>}
      <div className="acciones-fila">
        <button type="button" className="boton-mini principal" onClick={crear}>
          {guardando ? 'Creando…' : 'Crear producto'}
        </button>
        <button type="button" className="boton-mini discreto" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </fieldset>
  )
}
