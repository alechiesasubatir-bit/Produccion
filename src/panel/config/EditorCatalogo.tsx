import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { mensajeError } from '../../lib/errores'
import { useEnLinea } from '../../lib/useEnLinea'
import { actualizar, insertar, listar, type FilaCatalogo, type TablaCatalogo } from './datosCatalogo'

export type Campo = {
  clave: string
  etiqueta: string
  tipo: 'texto' | 'numero' | 'color' | 'seleccion'
  opciones?: string[]
  requerido?: boolean
  /** Para números: el valor tiene que ser mayor a este. */
  min?: number
}

type Borrador = Record<string, string>

const HEX = /^#[0-9a-fA-F]{6}$/

function validar(campos: Campo[], b: Borrador): Record<string, string> {
  const e: Record<string, string> = {}
  for (const c of campos) {
    const v = (b[c.clave] ?? '').trim()
    if (!v) {
      if (c.requerido) e[c.clave] = 'Obligatorio.'
      continue
    }
    if (c.tipo === 'numero' && !(Number(v) > (c.min ?? Number.NEGATIVE_INFINITY))) {
      e[c.clave] = c.min !== undefined ? `Tiene que ser mayor a ${c.min}.` : 'Número inválido.'
    }
    if (c.tipo === 'color' && !HEX.test(v)) e[c.clave] = 'Color inválido.'
  }
  return e
}

// Texto del formulario → valor para la base (números vacíos y opcionales → null).
function aDatos(campos: Campo[], b: Borrador): Record<string, unknown> {
  const d: Record<string, unknown> = {}
  for (const c of campos) {
    const v = (b[c.clave] ?? '').trim()
    d[c.clave] = c.tipo === 'numero' ? (v === '' ? null : Number(v)) : v
  }
  return d
}

const aBorrador = (campos: Campo[], f: Record<string, unknown>): Borrador =>
  Object.fromEntries(campos.map((c) => [c.clave, f[c.clave] === null || f[c.clave] === undefined ? '' : String(f[c.clave])]))

export function EditorCatalogo({
  tabla,
  campos,
  orden,
  nuevo,
  vistaPrevia,
}: {
  tabla: TablaCatalogo
  campos: Campo[]
  orden: string
  nuevo: Record<string, unknown>
  vistaPrevia?: (b: Borrador) => ReactNode
}) {
  const enLinea = useEnLinea()
  const [filas, setFilas] = useState<FilaCatalogo[]>([])
  const [editando, setEditando] = useState<string | null>(null) // id, 'nuevo' o null
  const [borrador, setBorrador] = useState<Borrador>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(() => {
    listar(tabla).then(
      (f) => setFilas([...f].sort((a, b) => String(a[orden]).localeCompare(String(b[orden]), 'es', { numeric: true }))),
      (e: unknown) => setAviso(mensajeError(e).texto),
    )
  }, [tabla, orden])

  useEffect(() => {
    setEditando(null)
    setAviso(null)
    cargar()
  }, [cargar])

  const editar = (id: string, valores: Record<string, unknown>) => {
    setEditando(id)
    setBorrador(aBorrador(campos, valores))
    setErrores({})
    setAviso(null)
  }

  const guardar = async () => {
    const e = validar(campos, borrador)
    setErrores(e)
    if (Object.keys(e).length) return
    const datos = aDatos(campos, borrador)
    const r = editando === 'nuevo' ? await insertar(tabla, { ...datos, activo: true }) : await actualizar(tabla, editando!, datos)
    if (r.error) {
      setAviso(mensajeError(r.error).texto)
      return
    }
    setEditando(null)
    cargar()
  }

  const alternarActivo = async (f: FilaCatalogo) => {
    const r = await actualizar(tabla, f.id, { activo: !f.activo })
    if (r.error) setAviso(mensajeError(r.error).texto)
    cargar()
  }

  const formulario = (
    <tr className="fila-edicion">
      {campos.map((c) => (
        <td key={c.clave}>
          <div className="campo">
            <label htmlFor={`cat-${c.clave}`} className="sr-only">
              {c.etiqueta}
            </label>
            {c.tipo === 'seleccion' ? (
              <select
                id={`cat-${c.clave}`}
                value={borrador[c.clave] ?? ''}
                onChange={(e) => setBorrador({ ...borrador, [c.clave]: e.target.value })}
              >
                {c.opciones?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : c.tipo === 'color' ? (
              <span className="campo-color">
                <input
                  type="color"
                  aria-label="Elegir color"
                  value={HEX.test(borrador[c.clave] ?? '') ? borrador[c.clave] : '#000000'}
                  onChange={(e) => setBorrador({ ...borrador, [c.clave]: e.target.value })}
                />
                <input
                  id={`cat-${c.clave}`}
                  className="mono"
                  value={borrador[c.clave] ?? ''}
                  onChange={(e) => setBorrador({ ...borrador, [c.clave]: e.target.value })}
                />
              </span>
            ) : (
              <input
                id={`cat-${c.clave}`}
                type={c.tipo === 'numero' ? 'number' : 'text'}
                value={borrador[c.clave] ?? ''}
                onChange={(e) => setBorrador({ ...borrador, [c.clave]: e.target.value })}
              />
            )}
            {errores[c.clave] && <span className="campo-error">{errores[c.clave]}</span>}
          </div>
        </td>
      ))}
      <td className="celda-acciones">
        {vistaPrevia && <span className="vista-previa">{vistaPrevia(borrador)}</span>}
        <button type="button" className="boton" onClick={() => void guardar()} disabled={!enLinea}>
          Guardar
        </button>
        <button type="button" className="boton boton-sec" onClick={() => setEditando(null)}>
          Cancelar
        </button>
      </td>
    </tr>
  )

  return (
    <div className="editor-catalogo">
      <div className="editor-barra">
        <button type="button" className="boton" onClick={() => editar('nuevo', nuevo)} disabled={!enLinea || editando === 'nuevo'}>
          + Agregar
        </button>
      </div>
      {aviso && (
        <p className="aviso-panel" role="alert">
          {aviso}
        </p>
      )}
      <table className="tabla">
        <thead>
          <tr>
            {campos.map((c) => (
              <th key={c.clave} scope="col">
                {c.etiqueta}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {editando === 'nuevo' && formulario}
          {filas.map((f) =>
            editando === f.id ? (
              <Fragment key={f.id}>{formulario}</Fragment>
            ) : (
              <tr key={f.id} className={f.activo ? '' : 'inactiva'}>
                {campos.map((c) => (
                  <td key={c.clave}>
                    {c.tipo === 'color' ? (
                      <span className="muestra-color">
                        <i style={{ background: String(f[c.clave]) }} aria-hidden="true" />
                        <span className="mono">{String(f[c.clave])}</span>
                      </span>
                    ) : (
                      String(f[c.clave] ?? '—')
                    )}
                  </td>
                ))}
                <td className="celda-acciones">
                  <button type="button" className="boton-mini" onClick={() => editar(f.id, f)} disabled={!enLinea}>
                    Editar
                  </button>
                  <button type="button" className="boton-mini" onClick={() => void alternarActivo(f)} disabled={!enLinea}>
                    {f.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}
