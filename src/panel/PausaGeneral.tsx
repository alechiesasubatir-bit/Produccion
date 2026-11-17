import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Entidad } from '../domain/acciones'
import type { FilaFlujo } from '../domain/flujo'
import type { Unidad } from '../domain/participaciones'
import {
  armarArranque,
  erroresArranque,
  faltanCantidades,
  ordenesEnMarcha,
  pideCantidad,
  unidadPorDefecto,
  type CantidadOrden,
  type EstadoArranque,
  type PausaAbierta,
  type RefOrden,
} from '../domain/pausaGeneral'
import { parsearCantidad } from '../domain/tareas'
import { arranqueGeneral, pausaGeneral } from '../lib/acciones'
import { mensajeError } from '../lib/errores'
import { horaMontevideo } from '../lib/hora'
import { cargarFlujo, cargarOperarias, type OperariaNombre } from './datosFlujo'
import { cargarOrdenesPausa } from './datosPausaGeneral'

const GRUPOS: { entidad: Entidad; titulo: string }[] = [
  { entidad: 'fabricacion', titulo: 'Fabricación' },
  { entidad: 'envasado', titulo: 'Envasado' },
  { entidad: 'fraccionado', titulo: 'Fraccionado' },
]

const NOMBRE_ENTIDAD: Record<Entidad, string> = {
  fabricacion: 'fabricación',
  envasado: 'envasado',
  fraccionado: 'fraccionado',
}

const CERRADAS = new Set(['finalizada', 'finalizado', 'cancelada', 'cancelado'])

const hora = (iso: string) => horaMontevideo(new Date(iso).getTime())
const clave = (r: RefOrden) => `${r.entidad}:${r.id}`
const detalle = (o: FilaFlujo) => (o.entidad === 'fabricacion' ? o.tanque_codigo : o.presentacion ?? o.tanque_codigo)
const enCurso = (o: FilaFlujo) => o.estado === 'fabricando' || o.estado === 'activo'

// Botón grande del encabezado: «Pausa General» o, con la planta en pausa, «Arranque».
export function BotonPausaGeneral({ pausa, onCambio }: { pausa: PausaAbierta | null; onCambio?: () => void }) {
  // El modo se fija al abrir: si la pausa cambia (otra pestaña, o la propia respuesta por realtime),
  // el diálogo se cierra; nunca se convierte en el opuesto.
  const [abierto, setAbierto] = useState<'pausa' | 'arranque' | null>(null)
  const modoActual = pausa ? 'arranque' : 'pausa'
  if (abierto !== null && abierto !== modoActual) setAbierto(null)
  const cerrar = () => setAbierto(null)
  const listo = () => {
    setAbierto(null)
    onCambio?.()
  }

  return (
    <>
      <button
        type="button"
        className={`boton-pausa-general${pausa ? ' es-arranque' : ''}`}
        onClick={() => setAbierto(modoActual)}
      >
        <span className="bpg-texto">{pausa ? 'Arranque' : 'Pausa General'}</span>
        {pausa && <span className="bpg-desde">en pausa desde {hora(pausa.inicio)}</span>}
      </button>
      {abierto === 'arranque' && pausa && <DialogoArranque pausa={pausa} onCerrar={cerrar} onListo={listo} />}
      {abierto === 'pausa' && !pausa && <DialogoPausa onCerrar={cerrar} onListo={listo} />}
    </>
  )
}

// `planta`: texto de la tablet, que además dice quién la levanta.
export function FranjaPausa({ pausa, planta = false }: { pausa: PausaAbierta; planta?: boolean }) {
  return (
    <div className="franja-pausa" role="status">
      Planta en pausa general desde {hora(pausa.inicio)}
      {planta && ' — la encargada la levanta con Arranque'}
    </div>
  )
}

// Cerrar un diálogo con datos cargados (Escape, click afuera, × o Cancelar) primero pregunta.
function useCierreSeguro(sucio: boolean, onCerrar: () => void, que: string) {
  const [preguntando, setPreguntando] = useState(false)
  const intentar = () => (sucio ? setPreguntando(true) : onCerrar())
  const aviso = preguntando && (
    <div className="pg-descartar" role="alert">
      <span>¿Descartar {que}?</span>
      <button type="button" className="boton boton-sec" onClick={() => setPreguntando(false)}>
        Seguir
      </button>
      <button type="button" className="boton" onClick={onCerrar}>
        Descartar
      </button>
    </div>
  )
  return { intentar, aviso }
}

function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  const id = useId()
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

  return createPortal(
    <div className="modal-fondo" onClick={onCerrar}>
      <div
        ref={dialogo}
        tabIndex={-1}
        className="modal modal-pausa-general"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-cabecera">
          <h2 id={id}>{titulo}</h2>
          <button type="button" className="boton boton-sec" onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function DialogoPausa({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [ordenes, setOrdenes] = useState<FilaFlujo[] | null>(null)
  const [textos, setTextos] = useState<Record<string, string>>({})
  const [unidades, setUnidades] = useState<Record<string, Unidad>>({})
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    cargarFlujo().then(
      (flujo) => vigente && setOrdenes(ordenesEnMarcha(flujo)),
      (e: unknown) => vigente && setError(mensajeError(e).texto),
    )
    return () => {
      vigente = false
    }
  }, [])

  const lista = ordenes ?? []
  const unidad = (o: FilaFlujo) => unidades[clave(o)] ?? unidadPorDefecto(o)
  const cantidades: CantidadOrden[] = lista.filter(pideCantidad).flatMap((o) =>
    o.operarias.flatMap((op) => {
      const n = parsearCantidad(textos[`${clave(o)}:${op.empleado_id}`] ?? '')
      return n === null ? [] : [{ entidad: o.entidad, id: o.id, empleadoId: op.empleado_id, cantidad: n, unidad: unidad(o) }]
    }),
  )
  const puedeConfirmar = lista.length > 0 && faltanCantidades(lista, cantidades).length === 0 && !enviando
  const sucio = Object.values(textos).some((t) => t.trim() !== '') || Object.keys(unidades).length > 0
  const cierre = useCierreSeguro(sucio, onCerrar, 'las cantidades cargadas')

  const confirmar = async () => {
    setEnviando(true)
    setError(null)
    const r = await pausaGeneral(cantidades)
    setEnviando(false)
    if (r.ok) onListo()
    else setError(r.texto)
  }

  return (
    <Modal titulo="Pausa General" onCerrar={cierre.intentar}>
      {ordenes === null && !error && <p className="pg-nota">Cargando órdenes…</p>}
      {ordenes !== null && lista.length === 0 && <p className="pg-vacio">No hay órdenes en marcha</p>}
      {lista.length > 0 && (
        <p className="pg-nota">
          Se pausan todas las órdenes en marcha y salen las operarias. En envasado y fraccionado, cargá cuánto hizo
          cada una.
        </p>
      )}
      {GRUPOS.map((g) => {
        const delGrupo = lista.filter((o) => o.entidad === g.entidad)
        if (delGrupo.length === 0) return null
        return (
          <section key={g.entidad} className="pg-grupo">
            <h3>{g.titulo}</h3>
            <ul className="pg-ordenes">
              {delGrupo.map((o) => (
                <li key={o.id} className="pg-orden">
                  <div className="pg-orden-titulo">
                    <strong>{o.producto ?? 'Sin producto'}</strong>
                    {detalle(o) && <span className="pg-detalle">{detalle(o)}</span>}
                    <span className={`pg-estado${enCurso(o) ? ' en-curso' : ''}`}>
                      {enCurso(o) ? 'En curso' : 'Pausada'}
                    </span>
                  </div>
                  {!pideCantidad(o) || o.operarias.length === 0 ? (
                    <p className="pg-operarias">
                      {o.operarias.length > 0 ? o.operarias.map((op) => op.nombre).join(', ') : 'Sin operarias'}
                    </p>
                  ) : (
                    <div className="pg-cantidades">
                      {o.operarias.map((op) => {
                        const k = `${clave(o)}:${op.empleado_id}`
                        const texto = textos[k] ?? ''
                        return (
                          <label key={op.empleado_id} className="pg-cantidad">
                            <span>{op.nombre}</span>
                            <input
                              inputMode="decimal"
                              autoComplete="off"
                              aria-label={`Cantidad de ${op.nombre}`}
                              aria-invalid={texto.trim() !== '' && parsearCantidad(texto) === null}
                              value={texto}
                              onChange={(e) => setTextos((t) => ({ ...t, [k]: e.target.value }))}
                            />
                          </label>
                        )
                      })}
                      <select
                        className="pg-unidad"
                        aria-label={`Unidad de ${o.producto ?? 'la orden'}`}
                        value={unidad(o)}
                        onChange={(e) => setUnidades((u) => ({ ...u, [clave(o)]: e.target.value as Unidad }))}
                      >
                        <option value="L">L</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {error && (
        <p className="aviso-panel" role="alert">
          {error}
        </p>
      )}
      {cierre.aviso}
      <footer className="modal-pie">
        <button type="button" className="boton boton-sec" onClick={cierre.intentar}>
          Cancelar
        </button>
        <button type="button" className="boton" disabled={!puedeConfirmar} onClick={() => void confirmar()}>
          {enviando ? 'Pausando…' : 'Confirmar pausa'}
        </button>
      </footer>
    </Modal>
  )
}

function DialogoArranque({
  pausa,
  onCerrar,
  onListo,
}: {
  pausa: PausaAbierta
  onCerrar: () => void
  onListo: () => void
}) {
  const [estados, setEstados] = useState<EstadoArranque[] | null>(null)
  // Operarias que se muestran por orden (las de ayer más las sumadas), aunque se destilden.
  const [candidatas, setCandidatas] = useState<Record<string, string[]>>({})
  const [operarias, setOperarias] = useState<OperariaNombre[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    Promise.all([cargarOrdenesPausa(pausa.id), cargarFlujo(), cargarOperarias()]).then(
      ([filas, flujo, ops]) => {
        if (!vigente) return
        const e = armarArranque(filas, flujo, new Set(ops.map((o) => o.empleado_id)))
        setOperarias(ops)
        setCandidatas(Object.fromEntries(e.map((x) => [clave(x.ref), [...x.empleados]])))
        setEstados(e)
      },
      (e: unknown) => vigente && setError(mensajeError(e).texto),
    )
    return () => {
      vigente = false
    }
  }, [pausa.id])

  const nombres = new Map(operarias.map((o): [string, string] => [o.empleado_id, o.nombre]))
  const lista = estados ?? []
  const errores = erroresArranque(lista, nombres)

  const cambiar = (ref: RefOrden, f: (x: EstadoArranque) => EstadoArranque) => {
    setTocado(true)
    setEstados((es) => es && es.map((x) => (clave(x.ref) === clave(ref) ? f(x) : x)))
  }
  const alternarOperaria = (ref: RefOrden, id: string) =>
    cambiar(ref, (x) => ({
      ...x,
      empleados: x.empleados.includes(id) ? x.empleados.filter((e) => e !== id) : [...x.empleados, id],
    }))
  const sumar = (ref: RefOrden, id: string) => {
    setCandidatas((c) => ({ ...c, [clave(ref)]: [...(c[clave(ref)] ?? []), id] }))
    cambiar(ref, (x) => ({ ...x, empleados: [...x.empleados, id] }))
  }

  const puedeConfirmar = estados !== null && Object.keys(errores).length === 0 && !enviando
  const [tocado, setTocado] = useState(false)
  const cierre = useCierreSeguro(tocado, onCerrar, 'los cambios del arranque')

  const confirmar = async () => {
    setEnviando(true)
    setError(null)
    const r = await arranqueGeneral(
      lista.filter((x) => x.reanudar && !x.cerrada).map((x) => ({ ...x.ref, empleados: x.empleados })),
    )
    setEnviando(false)
    if (r.ok) onListo()
    else setError(r.texto)
  }

  return (
    <Modal titulo="Arranque" onCerrar={cierre.intentar}>
      <p className="pg-nota">
        Planta en pausa desde las {hora(pausa.inicio)}. Marcá las órdenes que se reanudan y quiénes vuelven a cada una.
      </p>
      {estados === null && !error && <p className="pg-nota">Cargando órdenes…</p>}
      {GRUPOS.map((g) => {
        const delGrupo = lista.filter((x) => x.ref.entidad === g.entidad)
        if (delGrupo.length === 0) return null
        return (
          <section key={g.entidad} className="pg-grupo">
            <h3>{g.titulo}</h3>
            <ul className="pg-ordenes">
              {delGrupo.map((x) => {
                const k = clave(x.ref)
                const titulo = x.orden?.producto ?? `Orden de ${NOMBRE_ENTIDAD[x.ref.entidad]}`
                if (x.cerrada) {
                  const cerradaDeNoche = !x.orden || CERRADAS.has(x.orden.estado)
                  return (
                    <li key={k} className="pg-orden es-cerrada" role="group" aria-label={titulo}>
                      <div className="pg-orden-titulo">
                        <strong>{titulo}</strong>
                        {x.orden && detalle(x.orden) && <span className="pg-detalle">{detalle(x.orden)}</span>}
                        <span className="pg-estado">
                          {cerradaDeNoche ? 'cerrada en la noche' : 'reanudada durante la noche'}
                        </span>
                      </div>
                    </li>
                  )
                }
                const disponibles = operarias.filter((o) => !(candidatas[k] ?? []).includes(o.empleado_id))
                return (
                  <li key={k} className="pg-orden" role="group" aria-label={titulo}>
                    <div className="pg-orden-titulo">
                      <strong>{titulo}</strong>
                      {x.orden && detalle(x.orden) && <span className="pg-detalle">{detalle(x.orden)}</span>}
                      <label className="pg-reanudar">
                        <input
                          type="checkbox"
                          checked={x.reanudar}
                          onChange={(e) => cambiar(x.ref, (y) => ({ ...y, reanudar: e.target.checked }))}
                        />
                        Reanudar
                      </label>
                    </div>
                    <div className={`pg-operarias-arranque${x.reanudar ? '' : ' apagadas'}`}>
                      {(candidatas[k] ?? []).map((id) => (
                        <label key={id} className="pg-operaria">
                          <input
                            type="checkbox"
                            checked={x.empleados.includes(id)}
                            disabled={!x.reanudar}
                            onChange={() => alternarOperaria(x.ref, id)}
                          />
                          {nombres.get(id) ?? 'Operaria'}
                        </label>
                      ))}
                      <select
                        className="pg-sumar"
                        aria-label="Sumar operaria"
                        value=""
                        disabled={!x.reanudar || disponibles.length === 0}
                        onChange={(e) => e.target.value && sumar(x.ref, e.target.value)}
                      >
                        <option value="">Sumar operaria…</option>
                        {disponibles.map((o) => (
                          <option key={o.empleado_id} value={o.empleado_id}>
                            {o.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    {errores[k] && <p className="campo-error">{errores[k]}</p>}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {error && (
        <p className="aviso-panel" role="alert">
          {error}
        </p>
      )}
      {cierre.aviso}
      <footer className="modal-pie">
        <button type="button" className="boton boton-sec" onClick={cierre.intentar}>
          Cancelar
        </button>
        <button type="button" className="boton boton-arranque" disabled={!puedeConfirmar} onClick={() => void confirmar()}>
          {enviando ? 'Arrancando…' : 'Confirmar arranque'}
        </button>
      </footer>
    </Modal>
  )
}
