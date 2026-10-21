import { useState } from 'react'
import { escanearHoja } from './datosOrden'
import { reducirImagen } from './imagen'

// Foto de la hoja Macrosoft → datos para precargar el formulario. Si falla, el formulario
// queda como estaba (editable a mano).
export function EscanearHoja({
  tipo,
  onDatos,
  onCancelar,
}: {
  tipo: 'fabricacion' | 'envasado' | 'fraccionado'
  onDatos: (datos: Record<string, unknown>) => void
  onCancelar: () => void
}) {
  const [imagen, setImagen] = useState<string | null>(null)
  const [vista, setVista] = useState<string | null>(null)
  const [estado, setEstado] = useState<'listo' | 'analizando'>('listo')
  const [error, setError] = useState<string | null>(null)

  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return
    setError(null)
    try {
      const b64 = await reducirImagen(archivo)
      setImagen(b64)
      setVista(`data:image/jpeg;base64,${b64}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const analizar = async () => {
    if (!imagen) return
    setEstado('analizando')
    setError(null)
    const r = await escanearHoja(tipo, imagen)
    setEstado('listo')
    if (r.ok) onDatos(r.datos)
    else setError(r.error)
  }

  return (
    <div className="escanear">
      <label className="escanear-foto">
        <span>{vista ? 'Cambiar foto' : 'Sacá o elegí una foto de la hoja'}</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Foto de la hoja"
          onChange={(e) => void elegir(e.target.files?.[0])}
        />
      </label>
      {vista && <img className="escanear-vista" src={vista} alt="Vista previa de la hoja" />}
      {error && (
        <p className="aviso-panel" role="alert">
          {error}
        </p>
      )}
      <div className="escanear-acciones">
        <button type="button" className="boton boton-sec" onClick={onCancelar}>
          Cancelar
        </button>
        <button type="button" className="boton" onClick={() => void analizar()} disabled={!imagen || estado === 'analizando'}>
          {estado === 'analizando' ? 'Analizando…' : 'Analizar'}
        </button>
      </div>
    </div>
  )
}
