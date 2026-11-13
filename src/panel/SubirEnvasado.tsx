import { useEffect, useRef, useState } from 'react'
import { leerEnvasados, tipoDeHoja, type BloqueDocumento } from '../domain/envasadoPdf'
import { advertenciaSinAsignar, validarEnvasadoDocumento, type NuevoEnvasadoDocumento } from '../domain/ordenes'
import { useEnLinea } from '../lib/useEnLinea'
import { cargarLotesDocumento, crearEnvasadoDocumento, crearFraccionadoDocumento, crearGranelStock, type DatosOrden } from './datosOrden'
import { extraerFragmentos } from './leerPdf'
import { buscarGranel, type ArchivoInicial, type OtroTipo } from './SubirFormula'

type Tipo = 'envasado' | 'fraccionado'
type Abierta = DatosOrden['fabricacionesAbiertas'][number]

const STOCK = '__stock'
const SIN_LEER = 'No pude abrir el PDF. Probá con otro archivo o cargá la orden a mano.'
const ENTERO = 'Tiene que ser un número entero mayor a 0.'

type Tarjeta = {
  lote: string
  bloque: BloqueDocumento
  producto_id: string // granel (envasado) o producto (fraccionado)
  aproximada: boolean
  presentacion_id: string
  cantidad: number
  etiquetar: boolean
  etiqueta_id: string | null
  // '' = esperando fabricación; STOCK = granel de stock en un tanque libre; si no, id de la fabricación.
  destino: string
  stock: { tanque_id: string; litros: number; lote: string }
  granelCreado: string | null
  duplicado: boolean
  confirmado: boolean
  estado: 'pendiente' | 'creando' | 'creada'
  error: string | null
}

const numero = (n: number) => n.toLocaleString('es-AR', { useGrouping: false, maximumFractionDigits: 3 })
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(',', '.')
const aNumero = (v: string) => (v === '' ? 0 : Number(v))

function nuevaTarjeta(lote: string, bloque: BloqueDocumento, datos: DatosOrden, duplicados: Set<string>): Tarjeta {
  const g = bloque.granel
  const { producto, aproximada } = g
    ? buscarGranel(datos.productos, g.codigo, g.nombre)
    : { producto: datos.productos.find((p) => p.codigo === bloque.producto.codigo), aproximada: false }
  const presentacion = bloque.presentacion
  const pres = presentacion ? datos.presentaciones.find((p) => norm(p.nombre) === norm(presentacion)) : undefined
  const abiertas = producto ? datos.fabricacionesAbiertas.filter((f) => f.producto_id === producto.id) : []
  return {
    lote,
    bloque,
    producto_id: producto?.id ?? '',
    aproximada,
    presentacion_id: pres?.id ?? '',
    cantidad: bloque.producto.cantidad,
    etiquetar: false,
    etiqueta_id: null,
    destino: abiertas.length === 1 ? abiertas[0].id : '',
    stock: { tanque_id: '', litros: g?.litros ?? 0, lote: '' },
    granelCreado: null,
    duplicado: duplicados.has(lote),
    confirmado: false,
    estado: 'pendiente',
    error: null,
  }
}

// PDF «Movimientos de Produccion — Fabrica Envasado»: una tarjeta por bloque (envasado o fraccionado,
// según la pestaña). El archivo se lee en el navegador: no se sube a ningún lado.
export function SubirEnvasado({
  datos,
  tipo,
  onCreadas,
  onAlgunaCreada,
  onOtroTipo,
  inicial,
}: {
  datos: DatosOrden
  tipo: Tipo
  /** Todas las tarjetas quedaron creadas. */
  onCreadas: () => void
  /** Se creó una (aunque otras sigan pendientes): quien cierre el modal tiene que recargar. */
  onAlgunaCreada?: () => void
  /** Era una fórmula: se abre en Fabricación. */
  onOtroTipo?: OtroTipo
  /** Archivo que llegó desde otra pestaña, con el aviso de por qué. */
  inicial?: ArchivoInicial
}) {
  const enLinea = useEnLinea()
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [omitidos, setOmitidos] = useState(0)
  const avisado = useRef(false)
  const inicialLeido = useRef(false)
  // Granel de stock creado desde este modal: queda a disposición de las demás tarjetas del mismo PDF.
  const [creadas, setCreadas] = useState<Abierta[]>([])
  const enCurso = useRef(new Set<number>())
  // Tarjetas ya creadas, al instante (el estado de React llega un render después).
  const hechas = useRef(new Set<number>())

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
    setOmitidos(0)
    avisado.current = false
    hechas.current.clear()
    try {
      const fr = await extraerFragmentos(archivo)
      if (onOtroTipo && tipoDeHoja(fr) === 'formula') {
        onOtroTipo('fabricacion', 'Es una fórmula: la abrí en Fabricación.', archivo)
        return
      }
      const r = leerEnvasados(fr)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const todos = r.documentos.flatMap((d) => d.bloques.map((b) => [d.lote, b] as const))
      const propios = todos.filter(([, b]) => b.tipo === tipo)
      setOmitidos(todos.length - propios.length)
      // Duplicados: solo los lotes de este PDF y de esta pestaña (envasados con envasados, fraccionados con fraccionados).
      let duplicados = new Set<string>()
      try {
        duplicados = await cargarLotesDocumento(tipo, [...new Set(propios.map(([lote]) => lote))])
      } catch {
        // sin la consulta no se avisa, pero el alta sigue siendo posible
      }
      setCreadas([])
      setTarjetas(propios.map(([lote, b]) => nuevaTarjeta(lote, b, datos, duplicados)))
    } catch {
      setError(SIN_LEER)
    } finally {
      setLeyendo(false)
    }
  }

  useEffect(() => {
    if (!inicial || inicialLeido.current) return
    inicialLeido.current = true
    void elegir(inicial.archivo)
  }, [])

  const actualizar = (i: number, cambios: Partial<Tarjeta>) => setTarjetas((ts) => ts.map((t, j) => (j === i ? { ...t, ...cambios } : t)))
  // Al cambiar de granel las fabricaciones abiertas son otras: se vuelve a preseleccionar.
  const todasAbiertas = [...datos.fabricacionesAbiertas, ...creadas]
  const elegirGranel = (i: number, productoId: string) => {
    const abiertas = todasAbiertas.filter((f) => f.producto_id === productoId)
    actualizar(i, { producto_id: productoId, aproximada: false, destino: abiertas.length === 1 ? abiertas[0].id : '' })
  }

  const litrosLibres = (t: Tarjeta) =>
    t.destino === STOCK ? t.stock.litros : (todasAbiertas.find((f) => f.id === t.destino)?.sinAsignar ?? null)
  const datosEnvasado = (t: Tarjeta, fabricacionId: string | null): NuevoEnvasadoDocumento => ({
    fabricacion_id: fabricacionId,
    granel_id: t.producto_id || null,
    presentacion_id: t.presentacion_id,
    cantidad: t.cantidad,
    lote: t.lote,
    codigo: t.bloque.producto.codigo,
    descripcion: t.bloque.producto.descripcion,
    litros_granel: t.bloque.granel?.litros ?? null,
    etiqueta_id: t.etiquetar ? t.etiqueta_id : null,
  })
  // Los tanques que ya recibieron un granel de stock en este modal dejan de estar libres.
  const libres = datos.tanques.filter((t) => t.estado === 'libre' && !creadas.some((c) => c.tanque_id === t.tanque_id))
  // Litros de granel que el PDF pide de este producto en todas sus tarjetas: lo que hay que dejar en el tanque.
  const litrosDelGranel = (productoId: string) =>
    tarjetas.filter((x) => x.producto_id === productoId).reduce((a, x) => a + (x.bloque.granel?.litros ?? 0), 0)
  const errores = (t: Tarjeta) => {
    const e: Record<string, string | undefined> =
      tipo === 'envasado'
        ? { ...validarEnvasadoDocumento(datosEnvasado(t, null)) }
        : Number.isInteger(t.cantidad) && t.cantidad > 0
          ? {}
          : { cantidad: ENTERO }
    if (tipo === 'envasado' && !t.producto_id) e.producto_id = 'Elegí el producto del granel.'
    if (t.etiquetar && !t.etiqueta_id) e.etiqueta_id = 'Elegí una etiqueta.'
    if (t.destino === STOCK) {
      const tq = libres.find((x) => x.tanque_id === t.stock.tanque_id) ?? (t.granelCreado ? datos.tanques.find((x) => x.tanque_id === t.stock.tanque_id) : undefined)
      if (!tq) e.stock = 'Elegí un tanque libre.'
      else if (!(t.stock.litros > 0) || t.stock.litros > tq.capacidad_l) e.stock = `Los litros tienen que estar entre 1 y ${tq.capacidad_l}.`
    }
    return e
  }
  const valida = (t: Tarjeta) => t.estado === 'pendiente' && (!t.duplicado || t.confirmado) && Object.values(errores(t)).every((e) => !e)

  const crear = async (i: number, t: Tarjeta) => {
    if (enCurso.current.has(i) || hechas.current.has(i)) return
    enCurso.current.add(i)
    try {
      actualizar(i, { estado: 'creando', error: null })
      const consumibles = t.bloque.consumibles
      let r
      if (tipo === 'envasado') {
        let fabricacionId = t.destino === '' ? null : t.destino
        if (t.destino === STOCK) {
          let granel = t.granelCreado
          if (!granel) {
            const g = await crearGranelStock({
              tanque_id: t.stock.tanque_id,
              producto_id: t.producto_id,
              litros: t.stock.litros,
              lote: t.stock.lote.trim() || null,
            })
            if (!g.ok) {
              actualizar(i, { estado: 'pendiente', error: g.texto })
              return
            }
            granel = g.id
            // Si el envasado falla, el granel ya existe: no se vuelve a crear al reintentar.
            actualizar(i, { granelCreado: granel })
            setCreadas((c) => [
              ...c,
              { id: granel as string, producto_id: t.producto_id, tanque_id: t.stock.tanque_id, lote: t.stock.lote.trim() || null, litros: t.stock.litros, sinAsignar: t.stock.litros },
            ])
          }
          fabricacionId = granel
        }
        r = await crearEnvasadoDocumento(datosEnvasado(t, fabricacionId), consumibles)
      } else {
        r = await crearFraccionadoDocumento(
          {
            producto_id: t.producto_id || null,
            presentacion_id: t.presentacion_id || null,
            cantidad: t.cantidad,
            lote: t.lote,
            codigo: t.bloque.producto.codigo,
            descripcion: t.bloque.producto.descripcion,
            etiqueta_id: t.etiquetar ? t.etiqueta_id : null,
          },
          consumibles,
        )
      }
      actualizar(i, r.ok ? { estado: 'creada', error: null } : { estado: 'pendiente', error: r.texto })
      if (r.ok) {
        hechas.current.add(i)
        onAlgunaCreada?.()
      }
    } finally {
      enCurso.current.delete(i)
    }
  }

  // Una por vez, para que cada error quede en su tarjeta.
  const crearTodas = async () => {
    const aCrear = tarjetas.map((t, i) => [i, t] as const).filter(([, t]) => valida(t))
    for (const [i, t] of aCrear) await crear(i, t)
  }

  const creando = tarjetas.some((t) => t.estado === 'creando')
  const otro = tipo === 'envasado' ? 'fraccionado' : 'envasado'

  return (
    <div className="subir-formula">
      <label className="subir-formula-archivo">
        <span>{leyendo ? 'Leyendo el PDF…' : tarjetas.length ? 'Elegir otro PDF' : 'Elegí el PDF «Movimientos de Produccion»'}</span>
        <input
          type="file"
          accept="application/pdf"
          aria-label="PDF de envasado"
          disabled={leyendo || creando}
          onChange={(e) => void elegir(e.target.files?.[0])}
        />
      </label>
      {inicial && (
        <p className="advertencia" role="status">
          {inicial.aviso}
        </p>
      )}
      {error && (
        <p className="aviso-panel" role="alert">
          {error}
        </p>
      )}
      {omitidos > 0 && (
        <p className="advertencia" role="status">
          Se omitieron {omitidos} {omitidos === 1 ? 'renglón' : 'renglones'} de {otro}: cargalos desde esa pestaña.
        </p>
      )}

      {tarjetas.map((t, i) => {
        const id = `envasado-${i}`
        const e = errores(t)
        const bloqueada = t.estado !== 'pendiente'
        const b = t.bloque
        const abiertas = todasAbiertas.filter((f) => f.producto_id === t.producto_id)
        const litrosEquiv = datos.presentaciones.find((p) => p.id === t.presentacion_id)?.litros_equiv ?? null
        const aviso = tipo === 'envasado' ? advertenciaSinAsignar(t.cantidad, litrosEquiv, litrosLibres(t)) : null
        return (
          <section key={id} className="formula" aria-labelledby={`${id}-titulo`}>
            <header className="formula-cabecera">
              <h3 id={`${id}-titulo`}>
                Lote {t.lote} · {b.producto.descripcion} · {numero(b.producto.cantidad)}
              </h3>
              {t.estado === 'creada' && <span className="formula-creada">Creada</span>}
            </header>

            <dl className="formula-datos">
              <div>
                <dt>Código</dt>
                <dd>{b.producto.codigo}</dd>
              </div>
              {b.granel && (
                <div>
                  <dt>Granel</dt>
                  <dd>
                    {b.granel.nombre} · {numero(b.granel.litros)} L
                  </dd>
                </div>
              )}
            </dl>

            {t.duplicado && t.estado === 'pendiente' && (
              <p className="advertencia" role="status">
                Este documento ya se cargó (lote {t.lote}). ¿Crear igual?{' '}
                {t.confirmado ? (
                  'Confirmado.'
                ) : (
                  <button type="button" className="boton-mini" disabled={creando} onClick={() => actualizar(i, { confirmado: true })}>
                    Crear igual
                  </button>
                )}
              </p>
            )}
            {t.aproximada && (
              <p className="advertencia" role="status">
                Coincidencia aproximada: revisá el producto del granel{' '}
                <button type="button" className="boton-mini" disabled={bloqueada || creando} onClick={() => actualizar(i, { aproximada: false })}>
                  Es este producto
                </button>
              </p>
            )}
            {tipo === 'envasado' && !t.producto_id && b.granel && (
              <p className="advertencia" role="status">
                No encontré «{b.granel.nombre}» en productos
              </p>
            )}

            <fieldset className="formulario formula-campos" disabled={bloqueada || creando}>
              <div className="campo">
                <label htmlFor={`${id}-producto`}>{tipo === 'envasado' ? 'Producto del granel' : 'Producto (opcional)'}</label>
                <select id={`${id}-producto`} value={t.producto_id} onChange={(ev) => elegirGranel(i, ev.target.value)}>
                  <option value="">{tipo === 'envasado' ? '— Elegí un producto —' : '—'}</option>
                  {datos.productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                {e.producto_id && <span className="campo-error">{e.producto_id}</span>}
              </div>
              <div className="campo">
                <label htmlFor={`${id}-pres`}>Presentación</label>
                <select id={`${id}-pres`} value={t.presentacion_id} onChange={(ev) => actualizar(i, { presentacion_id: ev.target.value })}>
                  <option value="">{tipo === 'envasado' ? '— Elegí una presentación —' : '—'}</option>
                  {datos.presentaciones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                {e.presentacion_id && <span className="campo-error">{e.presentacion_id}</span>}
              </div>
              <div className="campo">
                <label htmlFor={`${id}-cant`}>Cantidad</label>
                <input
                  id={`${id}-cant`}
                  type="number"
                  min="1"
                  step="1"
                  value={t.cantidad || ''}
                  onChange={(ev) => actualizar(i, { cantidad: aNumero(ev.target.value) })}
                />
                {e.cantidad && <span className="campo-error">{e.cantidad}</span>}
              </div>
              {aviso && (
                <p className="advertencia" role="status">
                  {aviso}
                </p>
              )}

              <fieldset className="campo">
                <legend>Etiquetado</legend>
                <label>
                  <input
                    type="radio"
                    name={`${id}-etiquetar`}
                    checked={!t.etiquetar}
                    onChange={() => actualizar(i, { etiquetar: false, etiqueta_id: null })}
                  />{' '}
                  No
                </label>{' '}
                <label>
                  <input type="radio" name={`${id}-etiquetar`} checked={t.etiquetar} onChange={() => actualizar(i, { etiquetar: true })} /> Sí
                </label>
              </fieldset>
              {t.etiquetar && (
                <div className="campo">
                  <label htmlFor={`${id}-etiqueta`}>Etiqueta</label>
                  <select
                    id={`${id}-etiqueta`}
                    value={t.etiqueta_id ?? ''}
                    onChange={(ev) => actualizar(i, { etiqueta_id: ev.target.value || null })}
                  >
                    <option value="">Elegí una etiqueta</option>
                    {datos.etiquetas.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                  </select>
                  {e.etiqueta_id && <span className="campo-error">{e.etiqueta_id}</span>}
                </div>
              )}

              {tipo === 'envasado' && (
                <>
                  <div className="campo">
                    <label htmlFor={`${id}-tanque`}>Tanque</label>
                    <select
                      id={`${id}-tanque`}
                      value={t.destino}
                      disabled={t.granelCreado !== null}
                      onChange={(ev) =>
                        actualizar(
                          i,
                          ev.target.value === STOCK
                            ? { destino: STOCK, stock: { ...t.stock, litros: litrosDelGranel(t.producto_id) || t.stock.litros } }
                            : { destino: ev.target.value },
                        )
                      }
                    >
                      <option value="">Esperando fabricación</option>
                      {abiertas.map((f) => (
                        <option key={f.id} value={f.id}>
                          {datos.tanques.find((x) => x.tanque_id === f.tanque_id)?.codigo ?? '—'} · lote {f.lote ?? '—'} · quedan{' '}
                          {numero(f.sinAsignar)} L sin asignar
                        </option>
                      ))}
                      <option value={STOCK}>Granel de stock en un tanque libre…</option>
                    </select>
                  </div>
                  {t.destino === STOCK && (
                    <div className="formula-stock">
                      <div className="campo">
                        <label htmlFor={`${id}-stock-tanque`}>Tanque libre</label>
                        <select
                          id={`${id}-stock-tanque`}
                          value={t.stock.tanque_id}
                          disabled={t.granelCreado !== null}
                          onChange={(ev) => actualizar(i, { stock: { ...t.stock, tanque_id: ev.target.value } })}
                        >
                          <option value="">— Elegí un tanque libre —</option>
                          {libres.map((tq) => (
                            <option key={tq.tanque_id} value={tq.tanque_id}>
                              {tq.codigo} · {tq.capacidad_l} L
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="campo">
                        <label htmlFor={`${id}-stock-litros`}>Litros del granel</label>
                        <input
                          id={`${id}-stock-litros`}
                          type="number"
                          min="1"
                          value={t.stock.litros || ''}
                          disabled={t.granelCreado !== null}
                          onChange={(ev) => actualizar(i, { stock: { ...t.stock, litros: aNumero(ev.target.value) } })}
                        />
                      </div>
                      <div className="campo">
                        <label htmlFor={`${id}-stock-lote`}>Lote del granel (opcional)</label>
                        <input
                          id={`${id}-stock-lote`}
                          value={t.stock.lote}
                          disabled={t.granelCreado !== null}
                          onChange={(ev) => actualizar(i, { stock: { ...t.stock, lote: ev.target.value } })}
                        />
                      </div>
                      {e.stock && <span className="campo-error">{e.stock}</span>}
                    </div>
                  )}
                </>
              )}
            </fieldset>

            <details>
              <summary>Consumibles ({b.consumibles.length})</summary>
              <table className="formula-mp">
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Descripción</th>
                    <th scope="col">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {b.consumibles.map((c, k) => (
                    <tr key={`${k}-${c.codigo}`}>
                      <td>{c.codigo}</td>
                      <td>{c.descripcion}</td>
                      <td>{numero(c.cantidad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

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
              </div>
            )}
          </section>
        )
      })}

      {tarjetas.length > 1 && !todasCreadas && (
        <div className="formula-acciones">
          <button type="button" className="boton" disabled={creando || !enLinea || !tarjetas.some(valida)} onClick={() => void crearTodas()}>
            Crear todas
          </button>
        </div>
      )}
    </div>
  )
}
