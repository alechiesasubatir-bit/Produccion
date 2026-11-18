import { useEffect, useRef, useState } from 'react'
import { coincidir } from '../domain/escaneo'
import { leerEnvasados, presentacionDe, sinPresentacion, tipoDeHoja, type BloqueDocumento } from '../domain/envasadoPdf'
import { advertenciaSinAsignar, validarEnvasadoDocumento, type NuevoEnvasadoDocumento } from '../domain/ordenes'
import { useEnLinea } from '../lib/useEnLinea'
import { cargarLotesDocumento, cargarProductosPorCodigo, crearEnvasadoDocumento, crearFraccionadoDocumento, crearGranelStock, type DatosOrden } from './datosOrden'
import { extraerFragmentos } from './leerPdf'
import { avisoSinProducto, buscarGranel, type ArchivoInicial, type OtroTipo } from './SubirFormula'

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
  parecidos: string[]
  presentacion_id: string
  cantidad: number
  etiquetar: boolean
  etiqueta_id: string | null
  // '' = esperando fabricación; STOCK = granel de stock en un tanque libre; si no, id de la fabricación.
  destino: string
  // litros null = los sugeridos (lo que pide el PDF de ese granel, sin pasar la capacidad del tanque).
  stock: { tanque_id: string; litros: number | null; lote: string }
  granelCreado: string | null
  duplicado: boolean
  confirmado: boolean
  estado: 'pendiente' | 'creando' | 'creada'
  error: string | null
}

const numero = (n: number) => n.toLocaleString('es-AR', { useGrouping: false, maximumFractionDigits: 3 })
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(',', '.')
const aNumero = (v: string) => (v === '' ? 0 : Number(v))

/** Producto del fraccionado: por código (del catálogo, o el elegido en un fraccionado anterior con ese código);
 * si no, por nombre sin la presentación («Pulidor pote x 1/2 Kg» → Pulidor), primero entre los del catálogo con esa
 * misma presentación en el nombre («Cloro Shock x 250g»). El código del PDF es de la presentación, no del producto:
 * no se guarda en el catálogo, queda en el fraccionado. */
export function buscarProducto(
  productos: DatosOrden['productos'],
  codigo: string,
  descripcion: string,
  previos: Map<string, string> = new Map(),
) {
  const previo = previos.get(codigo)
  const porCodigo = productos.find((p) => p.codigo === codigo) ?? productos.find((p) => p.id === previo)
  if (porCodigo) return { producto: porCodigo, aproximada: false, parecidos: [] }
  const pres = presentacionDe(descripcion)
  const nombre = sinPresentacion(descripcion)
  const catalogo = productos.map((p) => ({ p, nombre: sinPresentacion(p.nombre), pres: presentacionDe(p.nombre) }))
  const mismaPres = pres === null ? null : coincidir(nombre, catalogo.filter((c) => c.pres === pres))
  if (mismaPres && 'item' in mismaPres && mismaPres.exacta) return { producto: mismaPres.item.p, aproximada: false, parecidos: [] }
  const c = coincidir(nombre, catalogo.filter((x) => x.pres === null || x.pres === pres))
  if (c && 'item' in c) return { producto: c.item.p, aproximada: !c.exacta, parecidos: [] }
  return { producto: undefined, aproximada: false, parecidos: c ? c.ambiguas.map((x) => x.p.nombre) : [] }
}

function nuevaTarjeta(lote: string, bloque: BloqueDocumento, datos: DatosOrden, duplicados: Set<string>, previos: Map<string, string>): Tarjeta {
  const g = bloque.granel
  const { producto, aproximada, parecidos } = g
    ? buscarGranel(datos.productos, g.codigo, g.nombre)
    : buscarProducto(datos.productos, bloque.producto.codigo, bloque.producto.descripcion, previos)
  const presentacion = bloque.presentacion
  const pres = presentacion ? datos.presentaciones.find((p) => norm(p.nombre) === norm(presentacion)) : undefined
  const abiertas = producto ? datos.fabricacionesAbiertas.filter((f) => f.producto_id === producto.id) : []
  return {
    lote,
    bloque,
    producto_id: producto?.id ?? '',
    aproximada,
    parecidos,
    presentacion_id: pres?.id ?? '',
    cantidad: bloque.producto.cantidad,
    etiquetar: false,
    etiqueta_id: null,
    destino: abiertas.length === 1 ? abiertas[0].id : '',
    stock: { tanque_id: '', litros: null, lote: '' },
    granelCreado: null,
    duplicado: duplicados.has(lote.trim()),
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
  // Litros que las tarjetas ya creadas en este modal tomaron de cada fabricación (los «sin asignar»
  // de `datos` son de cuando se abrió).
  const [usados, setUsados] = useState<Record<string, number>>({})
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
        duplicados = await cargarLotesDocumento(tipo, [...new Set(propios.map(([lote]) => lote.trim()))])
      } catch {
        // sin la consulta no se avisa, pero el alta sigue siendo posible
      }
      let previos = new Map<string, string>()
      if (tipo === 'fraccionado') {
        try {
          previos = await cargarProductosPorCodigo([...new Set(propios.map(([, b]) => b.producto.codigo))])
        } catch {
          // sin historial se busca solo por nombre
        }
      }
      setCreadas([])
      setUsados({})
      setTarjetas(propios.map(([lote, b]) => nuevaTarjeta(lote, b, datos, duplicados, previos)))
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

  const sinAsignar = (f: Abierta) => f.sinAsignar - (usados[f.id] ?? 0)
  // Los tanques que ya recibieron un granel de stock en este modal dejan de estar libres.
  const libres = datos.tanques.filter((t) => t.estado === 'libre' && !creadas.some((c) => c.tanque_id === t.tanque_id))
  // Litros de granel que el PDF pide de este producto en todas sus tarjetas: lo que hay que dejar en el tanque.
  const litrosDelGranel = (t: Tarjeta) =>
    (t.producto_id ? tarjetas.filter((x) => x.producto_id === t.producto_id).reduce((a, x) => a + (x.bloque.granel?.litros ?? 0), 0) : 0) ||
    (t.bloque.granel?.litros ?? 0)
  const tanqueStock = (t: Tarjeta) => datos.tanques.find((x) => x.tanque_id === t.stock.tanque_id)
  // El tanque donde la tarjeta ya creó su granel deja de estar libre, pero el select lo sigue mostrando.
  const tanquesParaStock = (t: Tarjeta) => {
    const propio = t.granelCreado ? tanqueStock(t) : undefined
    return propio && !libres.includes(propio) ? [...libres, propio] : libres
  }
  const litrosStock = (t: Tarjeta) => t.stock.litros ?? Math.min(litrosDelGranel(t), tanqueStock(t)?.capacidad_l ?? Infinity)
  const litrosLibres = (t: Tarjeta) => {
    if (t.destino === STOCK) {
      const creada = t.granelCreado ? creadas.find((c) => c.id === t.granelCreado) : undefined
      return creada ? sinAsignar(creada) : litrosStock(t)
    }
    const f = todasAbiertas.find((x) => x.id === t.destino)
    return f ? sinAsignar(f) : null
  }
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
      else if (!(litrosStock(t) > 0) || litrosStock(t) > tq.capacidad_l) e.stock = `Los litros tienen que estar entre 1 y ${tq.capacidad_l}.`
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
            const litros = litrosStock(t)
            const g = await crearGranelStock({
              tanque_id: t.stock.tanque_id,
              producto_id: t.producto_id,
              litros,
              lote: t.stock.lote.trim() || null,
            })
            if (!g.ok) {
              actualizar(i, { estado: 'pendiente', error: g.texto })
              return
            }
            granel = g.id
            // Si el envasado falla, el granel ya existe: no se vuelve a crear al reintentar.
            actualizar(i, { granelCreado: granel, stock: { ...t.stock, litros } })
            setCreadas((c) => [
              ...c,
              { id: granel as string, producto_id: t.producto_id, tanque_id: t.stock.tanque_id, lote: t.stock.lote.trim() || null, litros, sinAsignar: litros },
            ])
          }
          fabricacionId = granel
        }
        r = await crearEnvasadoDocumento(datosEnvasado(t, fabricacionId), consumibles)
        const equiv = datos.presentaciones.find((p) => p.id === t.presentacion_id)?.litros_equiv
        if (r.ok && fabricacionId && equiv) {
          const usa = t.cantidad * equiv
          setUsados((u) => ({ ...u, [fabricacionId]: (u[fabricacionId] ?? 0) + usa }))
        }
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
                Coincidencia aproximada: revisá el producto{tipo === 'envasado' ? ' del granel' : ''}{' '}
                <button type="button" className="boton-mini" disabled={bloqueada || creando} onClick={() => actualizar(i, { aproximada: false })}>
                  Es este producto
                </button>
              </p>
            )}
            {tipo === 'envasado' && !t.producto_id && b.granel && (
              <p className="advertencia" role="status">
                {avisoSinProducto(b.granel.nombre, t.parecidos)}
              </p>
            )}
            {tipo === 'fraccionado' && !t.producto_id && (
              <p className="advertencia" role="status">
                {avisoSinProducto(sinPresentacion(b.producto.descripcion), t.parecidos)}: elegilo y queda registrado para
                la próxima vez que venga el código {b.producto.codigo}.
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
                            ? { destino: STOCK }
                            : { destino: ev.target.value },
                        )
                      }
                    >
                      <option value="">Esperando fabricación</option>
                      {abiertas.map((f) => (
                        <option key={f.id} value={f.id}>
                          {datos.tanques.find((x) => x.tanque_id === f.tanque_id)?.codigo ?? '—'} · lote {f.lote ?? '—'} · quedan{' '}
                          {numero(sinAsignar(f))} L sin asignar
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
                          {tanquesParaStock(t).map((tq) => (
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
                          value={litrosStock(t) || ''}
                          disabled={t.granelCreado !== null}
                          onChange={(ev) => actualizar(i, { stock: { ...t.stock, litros: aNumero(ev.target.value) } })}
                        />
                      </div>
                      {t.stock.litros === null && !t.granelCreado && tanqueStock(t) && litrosDelGranel(t) > tanqueStock(t)!.capacidad_l && (
                        <p className="advertencia" role="status">
                          El PDF pide {numero(litrosDelGranel(t))} L de este granel y el tanque admite {numero(tanqueStock(t)!.capacidad_l)} L.
                        </p>
                      )}
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
