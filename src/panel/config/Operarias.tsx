import { useCallback, useEffect, useMemo, useState } from 'react'
import { mensajeError } from '../../lib/errores'
import { useEnLinea } from '../../lib/useEnLinea'
import {
  altaOperaria,
  cambiarActiva,
  cambiarPin,
  listarFuncionarios,
  listarOperarias,
  type Funcionario,
  type OperariaConfig,
} from './datosPersonas'

const PIN = /^\d{4}$/
const HEX = /^#[0-9a-fA-F]{6}$/
const COLORES = ['#db2777', '#0284c7', '#16a34a', '#ea580c', '#7c3aed', '#0d9488']

function CambiarPin({ empleadoId, onListo }: { empleadoId: string; onListo: (aviso: string | null) => void }) {
  const [pin, setPin] = useState('')
  const valido = PIN.test(pin)
  return (
    <span className="cambiar-pin">
      <input
        aria-label="PIN nuevo"
        className="mono"
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <button
        type="button"
        className="boton-mini"
        disabled={!valido}
        onClick={async () => {
          const r = await cambiarPin(empleadoId, pin)
          onListo(r.error ? mensajeError(r.error).texto : null)
        }}
      >
        Guardar PIN
      </button>
    </span>
  )
}

export function Operarias() {
  const enLinea = useEnLinea()
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [operarias, setOperarias] = useState<OperariaConfig[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [agregando, setAgregando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [sector, setSector] = useState('Producción')
  const [elegida, setElegida] = useState<Funcionario | null>(null)
  const [categoria, setCategoria] = useState('')
  const [color, setColor] = useState(COLORES[0])
  const [pin, setPin] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [pinDe, setPinDe] = useState<string | null>(null)

  const cargar = useCallback(() => {
    Promise.all([listarFuncionarios(), listarOperarias()]).then(
      ([f, o]) => {
        setFuncionarios(f)
        setOperarias(o)
      },
      (e: unknown) => setAviso(mensajeError(e).texto),
    )
  }, [])
  useEffect(cargar, [cargar])

  const porId = useMemo(() => new Map(funcionarios.map((f) => [f.id, f])), [funcionarios])
  const yaSon = useMemo(() => new Set(operarias.map((o) => o.empleado_id)), [operarias])
  const sectores = useMemo(() => [...new Set(funcionarios.map((f) => f.sector))].sort(), [funcionarios])
  const candidatas = funcionarios.filter(
    (f) =>
      !yaSon.has(f.id) &&
      (sector === '' || f.sector === sector) &&
      f.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
  )
  const filas = operarias
    .map((o) => ({ ...o, nombre: porId.get(o.empleado_id)?.nombre ?? 'Persona dada de baja' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  const cancelarAlta = () => {
    setAgregando(false)
    setElegida(null)
    setPin('')
    setCategoria('')
    setErrores({})
  }

  const darDeAlta = async () => {
    if (!elegida) return
    const e: Record<string, string> = {}
    if (!PIN.test(pin)) e.pin = 'El PIN son 4 dígitos.'
    if (!HEX.test(color)) e.color = 'Color inválido.'
    setErrores(e)
    if (Object.keys(e).length) return
    const r = await altaOperaria({ empleado_id: elegida.id, categoria: categoria.trim(), color_avatar: color }, pin)
    if (r.error) {
      setAviso(mensajeError(r.error).texto)
      cargar()
      return
    }
    setAviso(null)
    cancelarAlta()
    cargar()
  }

  return (
    <div className="operarias-config">
      <div className="editor-barra">
        <button type="button" className="boton" onClick={() => setAgregando(true)} disabled={!enLinea || agregando}>
          + Agregar operaria
        </button>
      </div>
      {aviso && (
        <p className="aviso-panel" role="alert">
          {aviso}
        </p>
      )}

      {agregando && (
        <section className="alta-operaria" aria-label="Agregar operaria">
          {!elegida ? (
            <>
              <div className="formulario">
                <div className="campo">
                  <label htmlFor="op-buscar">Buscar persona</label>
                  <input id="op-buscar" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor="op-sector">Sector</label>
                  <select id="op-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
                    <option value="">Todos</option>
                    {sectores.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <ul className="candidatas" aria-label="Personas disponibles">
                {candidatas.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="boton-mini" onClick={() => setElegida(f)}>
                      {f.nombre} <span className="apagado">· {f.sector}</span>
                    </button>
                  </li>
                ))}
                {candidatas.length === 0 && <li className="vacio">No hay personas para agregar con ese filtro.</li>}
              </ul>
              <button type="button" className="boton boton-sec" onClick={cancelarAlta}>
                Cancelar
              </button>
            </>
          ) : (
            <form
              className="formulario"
              onSubmit={(e) => {
                e.preventDefault()
                void darDeAlta()
              }}
            >
              <p className="alta-nombre">{elegida.nombre}</p>
              <div className="campo">
                <label htmlFor="op-cat">Categoría</label>
                <input id="op-cat" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="op-color">Color</label>
                <input id="op-color" className="mono" value={color} onChange={(e) => setColor(e.target.value)} />
                {errores.color && <span className="campo-error">{errores.color}</span>}
              </div>
              <div className="campo">
                <label htmlFor="op-pin">PIN inicial</label>
                <input
                  id="op-pin"
                  className="mono"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
                {errores.pin && <span className="campo-error">{errores.pin}</span>}
              </div>
              <footer className="modal-pie">
                <button type="button" className="boton boton-sec" onClick={cancelarAlta}>
                  Cancelar
                </button>
                <button type="submit" className="boton" disabled={!enLinea}>
                  Dar de alta
                </button>
              </footer>
            </form>
          )}
        </section>
      )}

      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Categoría</th>
            <th scope="col">Color</th>
            <th scope="col">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((o) => (
            <tr key={o.empleado_id} className={o.activo ? '' : 'inactiva'}>
              <td>{o.nombre}</td>
              <td>{o.categoria ?? '—'}</td>
              <td>
                <span className="muestra-color">
                  <i style={{ background: o.color_avatar ?? 'transparent' }} aria-hidden="true" />
                  <span className="mono">{o.color_avatar ?? '—'}</span>
                </span>
              </td>
              <td className="celda-acciones">
                {pinDe === o.empleado_id ? (
                  <CambiarPin
                    empleadoId={o.empleado_id}
                    onListo={(a) => {
                      setAviso(a)
                      if (!a) setPinDe(null)
                    }}
                  />
                ) : (
                  <button type="button" className="boton-mini" onClick={() => setPinDe(o.empleado_id)} disabled={!enLinea}>
                    Cambiar PIN
                  </button>
                )}
                <button
                  type="button"
                  className="boton-mini"
                  disabled={!enLinea}
                  onClick={async () => {
                    const r = await cambiarActiva(o.empleado_id, !o.activo)
                    setAviso(r.error ? mensajeError(r.error).texto : null)
                    cargar()
                  }}
                >
                  {o.activo ? 'Desactivar' : 'Activar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
