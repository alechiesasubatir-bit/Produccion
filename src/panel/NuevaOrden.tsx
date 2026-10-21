import { useEffect, useState, type ReactNode } from 'react'
import {
  validarEnvasado,
  validarFabricacion,
  validarFraccionado,
  type NuevaFabricacion,
  type NuevoEnvasado,
  type NuevoFraccionado,
} from '../domain/ordenes'
import { proyeccionEnvasado, proyeccionFabricacion, textoProyeccion } from '../domain/proyecciones'
import { mensajeError } from '../lib/errores'
import { useEnLinea } from '../lib/useEnLinea'
import { cargarDatosOrden, crearOrden, type DatosOrden } from './datosOrden'

export type TipoOrden = 'fabricacion' | 'envasado' | 'fraccionado'

const TIPOS: { id: TipoOrden; texto: string }[] = [
  { id: 'fabricacion', texto: 'Fabricación' },
  { id: 'envasado', texto: 'Envasado' },
  { id: 'fraccionado', texto: 'Fraccionado' },
]
const PARA_ENVASAR = ['para_envasar', 'cola_env', 'envasando', 'env_pausado']

const vacioFab = (tanque = ''): NuevaFabricacion => ({ tanque_id: tanque, producto_id: '', litros: 0, lote: '', operaria_id: null })
const vacioEnv = (): NuevoEnvasado => ({
  fabricacion_id: '',
  presentacion_id: '',
  cantidad: 0,
  etiquetado: '',
  operaria_1: null,
  operaria_2: null,
})
const vacioFrac = (): NuevoFraccionado => ({
  tipo: '',
  descripcion: '',
  producto_id: null,
  presentacion_id: null,
  cantidad: 0,
  lote: '',
  etiquetado: '',
  operaria_id: null,
})

const num = (v: string) => (v === '' ? 0 : Number(v))
const opcional = (v: string) => (v === '' ? null : v)

function Campo({ id, etiqueta, error, children }: { id: string; etiqueta: string; error?: string; children: ReactNode }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {error && <span className="campo-error">{error}</span>}
    </div>
  )
}

export function NuevaOrden({
  abierta,
  tipoInicial = 'fabricacion',
  tanqueInicial,
  onCerrar,
  onCreada,
}: {
  abierta: boolean
  tipoInicial?: TipoOrden
  tanqueInicial?: string
  onCerrar: () => void
  onCreada: () => void
}) {
  const enLinea = useEnLinea()
  const [datos, setDatos] = useState<DatosOrden | null>(null)
  const [tipo, setTipo] = useState<TipoOrden>(tipoInicial)
  const [fab, setFab] = useState<NuevaFabricacion>(() => vacioFab(tanqueInicial))
  const [env, setEnv] = useState<NuevoEnvasado>(vacioEnv)
  const [frac, setFrac] = useState<NuevoFraccionado>(vacioFrac)
  const [tocados, setTocados] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierta) return
    setTipo(tipoInicial)
    setFab(vacioFab(tanqueInicial))
    setEnv(vacioEnv())
    setFrac(vacioFrac())
    setTocados(new Set())
    setError(null)
    cargarDatosOrden().then(setDatos, (e: unknown) => setError(mensajeError(e).texto))
  }, [abierta, tipoInicial, tanqueInicial])

  useEffect(() => {
    if (!abierta) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [abierta, onCerrar])

  if (!abierta) return null

  const tanques = datos?.tanques ?? []
  const libres = tanques.filter((t) => t.estado === 'libre')
  const aEnvasar = tanques.filter((t) => PARA_ENVASAR.includes(t.estado) && t.fabricacion_id)
  const tanqueFab = tanques.find((t) => t.tanque_id === fab.tanque_id)
  const tanqueEnv = aEnvasar.find((t) => t.fabricacion_id === env.fabricacion_id)
  const presentacion = datos?.presentaciones.find((p) => p.id === env.presentacion_id)
  // Lo que queda en el tanque menos lo ya pedido en envasados abiertos.
  const sinAsignar = (fabricacionId: string | null, restantes: number | null) =>
    restantes === null || !fabricacionId ? null : Math.max(0, restantes - (datos?.asignados[fabricacionId] ?? 0))

  // Tiempo estimado con la velocidad histórica (por producto o por presentación).
  const productoFab = datos?.productos.find((p) => p.id === fab.producto_id)
  const stdFab = datos?.estandares.find((e) => e.entidad === 'fabricacion' && e.clave === productoFab?.nombre)
  const stdEnv = datos?.estandares.find((e) => e.entidad === 'envasado' && e.clave === presentacion?.nombre)
  const minFab = proyeccionFabricacion(fab.litros, stdFab)
  const minEnv = proyeccionEnvasado(env.cantidad, stdEnv)

  const erroresFab = validarFabricacion(fab, {
    capacidad: tanqueFab?.capacidad_l ?? null,
    tanqueLibre: tanqueFab?.estado === 'libre',
  })
  const { errores: erroresEnv, advertencia } = validarEnvasado(env, {
    litrosRestantes: tanqueEnv ? sinAsignar(tanqueEnv.fabricacion_id, tanqueEnv.litros_restantes) : null,
    litrosEquiv: presentacion?.litros_equiv ?? null,
  })
  const erroresFrac = validarFraccionado(frac)
  const errores: Record<string, string | undefined> =
    tipo === 'fabricacion' ? erroresFab : tipo === 'envasado' ? erroresEnv : erroresFrac
  const hayErrores = Object.values(errores).some(Boolean)
  const err = (c: string) => (tocados.has(c) ? errores[c] : undefined)
  const tocar = (c: string) => setTocados((t) => new Set(t).add(c))

  const crear = async () => {
    setEnviando(true)
    setError(null)
    const r = await crearOrden(tipo, tipo === 'fabricacion' ? fab : tipo === 'envasado' ? env : frac)
    setEnviando(false)
    if (r.error) {
      setError(mensajeError(r.error).texto)
      return
    }
    onCreada()
  }

  const operariasOpciones = (
    <>
      <option value="">— Sin asignar —</option>
      {datos?.operarias.map((o) => (
        <option key={o.empleado_id} value={o.empleado_id}>
          {o.nombre}
        </option>
      ))}
    </>
  )

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nueva-orden-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-cabecera">
          <h2 id="nueva-orden-titulo">Nueva orden</h2>
          <button type="button" className="boton boton-sec" onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="segmentos" role="group" aria-label="Tipo de orden">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="segmento"
              aria-pressed={tipo === t.id}
              onClick={() => {
                setTipo(t.id)
                setTocados(new Set())
              }}
            >
              {t.texto}
            </button>
          ))}
        </div>

        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault()
            if (!hayErrores) void crear()
          }}
        >
          {tipo === 'fabricacion' && (
            <>
              <Campo id="o-tanque" etiqueta="Tanque" error={err('tanque_id')}>
                <select
                  id="o-tanque"
                  value={fab.tanque_id}
                  onChange={(e) => {
                    setFab({ ...fab, tanque_id: e.target.value })
                    tocar('tanque_id')
                  }}
                >
                  <option value="">— Elegí un tanque libre —</option>
                  {libres.map((t) => (
                    <option key={t.tanque_id} value={t.tanque_id}>
                      {t.codigo} · {t.capacidad_l} L
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="o-producto" etiqueta="Producto" error={err('producto_id')}>
                <select
                  id="o-producto"
                  value={fab.producto_id}
                  onChange={(e) => {
                    setFab({ ...fab, producto_id: e.target.value })
                    tocar('producto_id')
                  }}
                >
                  <option value="">— Elegí un producto —</option>
                  {datos?.productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="o-litros" etiqueta="Litros" error={err('litros')}>
                <input
                  id="o-litros"
                  type="number"
                  min="1"
                  inputMode="decimal"
                  placeholder={tanqueFab ? String(tanqueFab.capacidad_l) : ''}
                  value={fab.litros || ''}
                  onChange={(e) => {
                    setFab({ ...fab, litros: num(e.target.value) })
                    tocar('litros')
                  }}
                />
              </Campo>
              {minFab !== null && stdFab && <p className="proyeccion">{textoProyeccion(minFab, stdFab.velocidad, 'L')}</p>}
              <Campo id="o-lote" etiqueta="Lote">
                <input id="o-lote" value={fab.lote} onChange={(e) => setFab({ ...fab, lote: e.target.value })} />
              </Campo>
              <Campo id="o-operaria" etiqueta="Operaria (opcional)">
                <select
                  id="o-operaria"
                  value={fab.operaria_id ?? ''}
                  onChange={(e) => setFab({ ...fab, operaria_id: opcional(e.target.value) })}
                >
                  {operariasOpciones}
                </select>
              </Campo>
            </>
          )}

          {tipo === 'envasado' && (
            <>
              <Campo id="o-fab" etiqueta="Tanque a envasar" error={err('fabricacion_id')}>
                <select
                  id="o-fab"
                  value={env.fabricacion_id}
                  onChange={(e) => {
                    setEnv({ ...env, fabricacion_id: e.target.value })
                    tocar('fabricacion_id')
                  }}
                >
                  <option value="">— Elegí un tanque —</option>
                  {aEnvasar.map((t) => (
                    <option key={t.fabricacion_id} value={t.fabricacion_id ?? ''}>
                      {t.codigo} · {t.producto} · quedan {sinAsignar(t.fabricacion_id, t.litros_restantes) ?? '?'} L sin asignar
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="o-pres" etiqueta="Presentación" error={err('presentacion_id')}>
                <select
                  id="o-pres"
                  value={env.presentacion_id}
                  onChange={(e) => {
                    setEnv({ ...env, presentacion_id: e.target.value })
                    tocar('presentacion_id')
                  }}
                >
                  <option value="">— Elegí una presentación —</option>
                  {datos?.presentaciones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="o-cant" etiqueta="Cantidad" error={err('cantidad')}>
                <input
                  id="o-cant"
                  type="number"
                  min="1"
                  step="1"
                  value={env.cantidad || ''}
                  onChange={(e) => {
                    setEnv({ ...env, cantidad: num(e.target.value) })
                    tocar('cantidad')
                  }}
                />
              </Campo>
              {minEnv !== null && stdEnv && <p className="proyeccion">{textoProyeccion(minEnv, stdEnv.velocidad, 'u')}</p>}
              {advertencia && (
                <p className="advertencia" role="status">
                  {advertencia}
                </p>
              )}
              <Campo id="o-etiq" etiqueta="Etiquetado">
                <input id="o-etiq" value={env.etiquetado} onChange={(e) => setEnv({ ...env, etiquetado: e.target.value })} />
              </Campo>
              <Campo id="o-op1" etiqueta="Operaria 1 (opcional)">
                <select id="o-op1" value={env.operaria_1 ?? ''} onChange={(e) => setEnv({ ...env, operaria_1: opcional(e.target.value) })}>
                  {operariasOpciones}
                </select>
              </Campo>
              <Campo id="o-op2" etiqueta="Operaria 2 (opcional)" error={erroresEnv.operaria_2}>
                <select id="o-op2" value={env.operaria_2 ?? ''} onChange={(e) => setEnv({ ...env, operaria_2: opcional(e.target.value) })}>
                  {operariasOpciones}
                </select>
              </Campo>
            </>
          )}

          {tipo === 'fraccionado' && (
            <>
              <Campo id="o-tipo" etiqueta="Tipo" error={err('tipo')}>
                <input
                  id="o-tipo"
                  value={frac.tipo}
                  onChange={(e) => {
                    setFrac({ ...frac, tipo: e.target.value })
                    tocar('tipo')
                  }}
                />
              </Campo>
              <Campo id="o-desc" etiqueta="Descripción">
                <input id="o-desc" value={frac.descripcion} onChange={(e) => setFrac({ ...frac, descripcion: e.target.value })} />
              </Campo>
              <Campo id="o-fprod" etiqueta="Producto (opcional)">
                <select
                  id="o-fprod"
                  value={frac.producto_id ?? ''}
                  onChange={(e) => setFrac({ ...frac, producto_id: opcional(e.target.value) })}
                >
                  <option value="">—</option>
                  {datos?.productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="o-fpres" etiqueta="Presentación (opcional)">
                <select
                  id="o-fpres"
                  value={frac.presentacion_id ?? ''}
                  onChange={(e) => setFrac({ ...frac, presentacion_id: opcional(e.target.value) })}
                >
                  <option value="">—</option>
                  {datos?.presentaciones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="o-fcant" etiqueta="Cantidad" error={err('cantidad')}>
                <input
                  id="o-fcant"
                  type="number"
                  min="1"
                  step="1"
                  value={frac.cantidad || ''}
                  onChange={(e) => {
                    setFrac({ ...frac, cantidad: num(e.target.value) })
                    tocar('cantidad')
                  }}
                />
              </Campo>
              <Campo id="o-flote" etiqueta="Lote">
                <input id="o-flote" value={frac.lote} onChange={(e) => setFrac({ ...frac, lote: e.target.value })} />
              </Campo>
              <Campo id="o-fetiq" etiqueta="Etiquetado">
                <input id="o-fetiq" value={frac.etiquetado} onChange={(e) => setFrac({ ...frac, etiquetado: e.target.value })} />
              </Campo>
              <Campo id="o-fop" etiqueta="Operaria (opcional)">
                <select
                  id="o-fop"
                  value={frac.operaria_id ?? ''}
                  onChange={(e) => setFrac({ ...frac, operaria_id: opcional(e.target.value) })}
                >
                  {operariasOpciones}
                </select>
              </Campo>
            </>
          )}

          {error && (
            <p className="aviso-panel" role="alert">
              {error}
            </p>
          )}
          <footer className="modal-pie">
            <button type="button" className="boton boton-sec" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="boton" disabled={hayErrores || enviando || !enLinea || !datos}>
              Crear orden
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
