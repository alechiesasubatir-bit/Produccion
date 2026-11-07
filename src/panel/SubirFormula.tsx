import { useEffect, useRef, useState } from 'react'
import { coincidir } from '../domain/escaneo'
import { leerFormulas, type Formula } from '../domain/formulaPdf'
import { validarFabricacionFormula, type NuevaFabricacionFormula } from '../domain/ordenes'
import { useEnLinea } from '../lib/useEnLinea'
import { crearFabricacionFormula, type DatosOrden } from './datosOrden'
import { extraerFragmentos } from './leerPdf'

type Tarjeta = {
  formula: Formula
  fab: NuevaFabricacionFormula
  productoEncontrado: boolean
  // Producto precargado por coincidencia parcial de nombre (p. ej. «Bactipro» → «Bactipro Plus»):
  // hasta que la encargada lo confirme o elija otro, no se le asigna el código del PDF.
  aproximada: boolean
  estado: 'pendiente' | 'creando' | 'creada'
  error: string | null
  tocados: Set<string>
}

const SIN_LEER = 'No pude abrir el PDF. Probá con otro archivo o cargá la orden a mano.'

const numero = (n: number) => n.toLocaleString('es-AR', { useGrouping: false, maximumFractionDigits: 3 })
const fechaAr = (iso: string) => iso.split('-').reverse().join('/')
const opcional = (v: string) => (v === '' ? null : v)

// Campos que hacen falta para crear, en el orden del formulario (para el aviso junto a «Crear»).
const ETIQUETAS: [keyof NuevaFabricacionFormula, string][] = [
  ['lote', 'lote'],
  ['fecha_formula', 'fecha de la fórmula'],
  ['tanque_id', 'tanque'],
  ['producto_id', 'producto'],
  ['vencimiento', 'vencimiento'],
]
const enumerar = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

function nuevaTarjeta(formula: Formula, productos: DatosOrden['productos']): Tarjeta {
  // Primero por código del granel (F8); si no, por nombre normalizado.
  const porCodigo = productos.find((p) => p.codigo === formula.granel.codigo)
  const c = porCodigo ? null : coincidir(formula.granel.nombre, productos)
  const porNombre = c && 'item' in c ? c : null
  const producto = porCodigo ?? porNombre?.item
  // El código del PDF queda atado al producto para siempre: solo si la coincidencia es segura.
  const segura = Boolean(porCodigo) || Boolean(porNombre?.exacta)
  return {
    formula,
    fab: {
      tanque_id: '',
      producto_id: producto?.id ?? '',
      litros: formula.granel.litros,
      lote: formula.lote,
      operaria_id: null,
      vencimiento: '',
      fecha_formula: formula.fecha,
      codigo_producto: segura ? formula.granel.codigo : '',
    },
    productoEncontrado: Boolean(producto),
    aproximada: Boolean(porNombre && !porNombre.exacta),
    estado: 'pendiente',
    error: null,
    tocados: new Set(),
  }
}

// PDF «Movimientos de Produccion» → una tarjeta por fórmula; cada una se crea (fabricación + MP)
// por separado o con «Crear todas». El archivo se lee en el navegador: no se sube a ningún lado.
export function SubirFormula({
  datos,
  onCreadas,
  onAlgunaCreada,
}: {
  datos: DatosOrden
  /** Todas las tarjetas quedaron creadas. */
  onCreadas: () => void
  /** Se creó una (aunque otras sigan pendientes): quien cierre el modal tiene que recargar. */
  onAlgunaCreada?: () => void
}) {
  const enLinea = useEnLinea()
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const avisado = useRef(false)

  const todasCreadas = tarjetas.length > 0 && tarjetas.every((t) => t.estado === 'creada')
  useEffect(() => {
    if (todasCreadas && !avisado.current) {
      avisado.current = true
      onCreadas()
    }
  }, [todasCreadas, onCreadas])

  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return
    setLeyendo(true)
    setError(null)
    setTarjetas([])
    avisado.current = false
    try {
      const r = leerFormulas(await extraerFragmentos(archivo))
      if (r.ok) setTarjetas(r.formulas.map((f) => nuevaTarjeta(f, datos.productos)))
      else setError(r.error)
    } catch {
      setError(SIN_LEER)
    } finally {
      setLeyendo(false)
    }
  }

  const cambiar = (i: number, cambios: Partial<NuevaFabricacionFormula>) =>
    setTarjetas((ts) =>
      ts.map((t, j) =>
        j === i
          ? {
              ...t,
              fab: { ...t.fab, ...cambios },
              tocados: new Set([...t.tocados, ...Object.keys(cambios)]),
            }
          : t,
      ),
    )
  const actualizar = (i: number, cambios: Partial<Tarjeta>) => setTarjetas((ts) => ts.map((t, j) => (j === i ? { ...t, ...cambios } : t)))

  // Elegido (o confirmado) a mano por la encargada: ahí sí se le asigna el código del PDF.
  const elegirProducto = (i: number, t: Tarjeta, productoId: string) => {
    cambiar(i, { producto_id: productoId, codigo_producto: productoId ? t.formula.granel.codigo : '' })
    actualizar(i, { aproximada: false })
  }

  const tanque = (id: string) => datos.tanques.find((t) => t.tanque_id === id)
  const errores = (t: Tarjeta) => {
    const tq = tanque(t.fab.tanque_id)
    return validarFabricacionFormula(t.fab, {
      capacidad: tq?.capacidad_l ?? null,
      tanqueLibre: tq?.estado === 'libre',
      loteExiste: datos.lotesAbiertos.includes(t.fab.lote.trim()),
    })
  }
  const valida = (t: Tarjeta) => t.estado === 'pendiente' && Object.values(errores(t)).every((e) => !e)

  const crear = async (i: number, t: Tarjeta) => {
    actualizar(i, { estado: 'creando', error: null })
    const r = await crearFabricacionFormula({ ...t.fab, lote: t.fab.lote.trim() }, t.formula.mp)
    actualizar(i, r.ok ? { estado: 'creada', error: null } : { estado: 'pendiente', error: r.texto })
    if (r.ok) onAlgunaCreada?.()
  }

  // Una por vez, para que cada error quede en su tarjeta.
  const crearTodas = async () => {
    const aCrear = tarjetas.map((t, i) => [i, t] as const).filter(([, t]) => valida(t))
    for (const [i, t] of aCrear) await crear(i, t)
  }

  const libres = datos.tanques.filter((t) => t.estado === 'libre')
  const creando = tarjetas.some((t) => t.estado === 'creando')

  return (
    <div className="subir-formula">
      <label className="subir-formula-archivo">
        <span>{leyendo ? 'Leyendo el PDF…' : tarjetas.length ? 'Elegir otro PDF' : 'Elegí el PDF «Movimientos de Produccion»'}</span>
        <input
          type="file"
          accept="application/pdf"
          aria-label="PDF de la fórmula"
          disabled={leyendo || creando}
          onChange={(e) => void elegir(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p className="aviso-panel" role="alert">
          {error}
        </p>
      )}

      {tarjetas.map((t, i) => {
        const id = `formula-${i}`
        const e = errores(t)
        const ver = (c: keyof NuevaFabricacionFormula) => (t.tocados.has(c) ? e[c] : undefined)
        const bloqueada = t.estado !== 'pendiente'
        const loteEditable = !t.formula.lote
        const fechaEditable = !t.formula.fecha
        // Un tanque elegido en otra tarjeta no se ofrece acá.
        // Lo que falta y todavía no muestra su propio error (campo sin tocar): se avisa junto a «Crear».
        const falta = ETIQUETAS.filter(([c]) => e[c] && !t.tocados.has(c) && !(c === 'lote' && !loteEditable)).map(([, n]) => n)
        const opcionesTanque = libres.filter((tq) => !tarjetas.some((o, j) => j !== i && o.fab.tanque_id === tq.tanque_id))
        return (
          <section key={id} className="formula" aria-labelledby={`${id}-titulo`}>
            <header className="formula-cabecera">
              <h3 id={`${id}-titulo`}>
                Lote {t.formula.lote || '—'} · {t.formula.granel.nombre} · {numero(t.formula.granel.litros)} L
              </h3>
              {t.estado === 'creada' && <span className="formula-creada">Creada</span>}
            </header>

            <dl className="formula-datos">
              {!loteEditable && (
                <div>
                  <dt>Lote</dt>
                  <dd>{t.formula.lote}</dd>
                </div>
              )}
              {!fechaEditable && (
                <div>
                  <dt>Fecha de la fórmula</dt>
                  <dd>{fechaAr(t.formula.fecha)}</dd>
                </div>
              )}
              <div>
                <dt>Granel</dt>
                <dd>{t.formula.granel.codigo}</dd>
              </div>
            </dl>
            {!loteEditable && e.lote && <p className="campo-error">{e.lote}</p>}

            <table className="formula-mp">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {t.formula.mp.map((mp, k) => (
                  <tr key={`${k}-${mp.codigo}`}>
                    <td>{mp.codigo}</td>
                    <td>{mp.descripcion}</td>
                    <td>{numero(mp.cantidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {t.aproximada && (
              <p className="advertencia" role="status">
                Coincidencia aproximada: revisá el producto{' '}
                <button
                  type="button"
                  className="boton-mini"
                  disabled={bloqueada || creando}
                  onClick={() => elegirProducto(i, t, t.fab.producto_id)}
                >
                  Es este producto
                </button>
              </p>
            )}
            {!t.productoEncontrado && !t.fab.producto_id && (
              <p className="advertencia" role="status">
                No encontré «{t.formula.granel.nombre}» en productos
              </p>
            )}

            <fieldset className="formulario formula-campos" disabled={bloqueada || creando}>
              {loteEditable && (
                <div className="campo">
                  <label htmlFor={`${id}-lote`}>Lote</label>
                  <input id={`${id}-lote`} value={t.fab.lote} onChange={(ev) => cambiar(i, { lote: ev.target.value })} />
                  {ver('lote') && <span className="campo-error">{ver('lote')}</span>}
                </div>
              )}
              {fechaEditable && (
                <div className="campo">
                  <label htmlFor={`${id}-fecha`}>Fecha de la fórmula</label>
                  <input
                    id={`${id}-fecha`}
                    type="date"
                    value={t.fab.fecha_formula}
                    onChange={(ev) => cambiar(i, { fecha_formula: ev.target.value })}
                  />
                  {ver('fecha_formula') && <span className="campo-error">{ver('fecha_formula')}</span>}
                </div>
              )}
              <div className="campo">
                <label htmlFor={`${id}-tanque`}>Tanque</label>
                <select id={`${id}-tanque`} value={t.fab.tanque_id} onChange={(ev) => cambiar(i, { tanque_id: ev.target.value })}>
                  <option value="">— Elegí un tanque libre —</option>
                  {opcionesTanque.map((tq) => (
                    <option key={tq.tanque_id} value={tq.tanque_id}>
                      {tq.codigo} · {tq.capacidad_l} L
                    </option>
                  ))}
                </select>
                {t.tocados.has('tanque_id') && (e.tanque_id || e.litros) && <span className="campo-error">{e.tanque_id ?? e.litros}</span>}
              </div>
              <div className="campo">
                <label htmlFor={`${id}-producto`}>Producto</label>
                <select id={`${id}-producto`} value={t.fab.producto_id} onChange={(ev) => elegirProducto(i, t, ev.target.value)}>
                  <option value="">— Elegí un producto —</option>
                  {datos.productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                {ver('producto_id') && <span className="campo-error">{ver('producto_id')}</span>}
              </div>
              <div className="campo">
                <label htmlFor={`${id}-venc`}>Vencimiento</label>
                <input
                  id={`${id}-venc`}
                  type="date"
                  value={t.fab.vencimiento}
                  onChange={(ev) => cambiar(i, { vencimiento: ev.target.value })}
                />
                {ver('vencimiento') && <span className="campo-error">{ver('vencimiento')}</span>}
              </div>
              <div className="campo">
                <label htmlFor={`${id}-operaria`}>Operaria (opcional)</label>
                <select
                  id={`${id}-operaria`}
                  value={t.fab.operaria_id ?? ''}
                  onChange={(ev) => cambiar(i, { operaria_id: opcional(ev.target.value) })}
                >
                  <option value="">— Sin asignar —</option>
                  {datos.operarias.map((o) => (
                    <option key={o.empleado_id} value={o.empleado_id}>
                      {o.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>

            {t.error && (
              <p className="aviso-panel" role="alert">
                {t.error}
              </p>
            )}
            {t.estado !== 'creada' && (
              <div className="formula-acciones">
                <button type="button" className="boton" disabled={!valida(t) || creando || !enLinea} onClick={() => void crear(i, t)}>
                  {t.estado === 'creando' ? 'Creando…' : 'Crear'}
                </button>
                {t.estado === 'pendiente' && falta.length > 0 && <span className="formula-falta">Completá {enumerar(falta)}</span>}
              </div>
            )}
          </section>
        )
      })}

      {tarjetas.length > 1 && !todasCreadas && (
        <div className="formula-acciones">
          <button
            type="button"
            className="boton"
            disabled={creando || !enLinea || !tarjetas.some(valida)}
            onClick={() => void crearTodas()}
          >
            Crear todas
          </button>
        </div>
      )}
    </div>
  )
}
