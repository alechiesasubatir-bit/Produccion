import { useCallback, useEffect, useState } from 'react'
import { accionesPosibles, type Accion, type Entidad } from '../domain/acciones'
import { textoEventoOperaria } from '../domain/recorrido'
import { nivelTanque } from '../domain/tanque'
import { confirmacionPanel, etiquetaPanel } from '../domain/tareas'
import { accionPanel } from '../lib/acciones'
import { mensajeError } from '../lib/errores'
import type { EstadoTanqueFila } from '../pages/ParedTanques'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'
import { TablaMp } from './TablaMp'
import { ControlesOrden } from './ControlesOrden'
import { DialogoControl } from './DialogoControl'
import { cargarControles, cargarFabricacion, cargarRecorrido, type DatosFabricacion, type EventoRecorrido } from './datosTanque'
import { OperariasOrden } from './OperariasOrden'
import { QrTanque } from './QrTanque'

const VERBOS: Record<string, string> = {
  crear: 'creó',
  iniciar: 'inició',
  pausar: 'pausó',
  reanudar: 'reanudó',
  finalizar: 'finalizó',
  cancelar: 'canceló',
  editar: 'editó',
}
const CONFIRMAR: Accion[] = ['cancelar', 'finalizar']

const hora = (at: string) =>
  new Date(at).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Montevideo' })
const fechaAr = (iso: string) => iso.split('-').reverse().join('/')

// El estado del tanque mezcla fabricación y envasado: se separan para ofrecer acciones de cada uno.
function estadosDe(t: EstadoTanqueFila): { fabricacion: string | null; envasado: string | null } {
  const env: Record<string, string> = { envasando: 'activo', env_pausado: 'pausado', cola_env: 'cola' }
  if (t.estado === 'libre') return { fabricacion: null, envasado: null }
  if (t.estado in env) return { fabricacion: 'para_envasar', envasado: env[t.estado] }
  return { fabricacion: t.estado, envasado: null }
}

function Acciones({
  entidad,
  id,
  estado,
  titulo,
  onHecho,
  onCargarEnvasado,
}: {
  entidad: Entidad
  id: string
  estado: string
  titulo: string
  onHecho: (error: string | null) => void
  onCargarEnvasado?: () => void
}) {
  const [confirmando, setConfirmando] = useState<Accion | null>(null)
  const acciones = accionesPosibles(entidad, estado, 'panel')
  const lista = entidad === 'fabricacion' && estado === 'para_envasar' && !!onCargarEnvasado
  if (acciones.length === 0 && !lista) return null

  const tocar = async (a: Accion) => {
    if (CONFIRMAR.includes(a) && confirmando !== a) {
      setConfirmando(a)
      return
    }
    setConfirmando(null)
    const r = await accionPanel({ entidad, id, accion: a })
    onHecho(r.ok ? null : r.texto)
  }

  return (
    <div className="detalle-acciones">
      <span className="detalle-etiqueta">{titulo}</span>
      {lista && (
        <button type="button" className="boton-mini principal" onClick={onCargarEnvasado}>
          Cargar envasado
        </button>
      )}
      {acciones.map((a) => (
        <button
          key={a}
          type="button"
          className={`boton-mini${confirmando === a ? ' confirmar' : ''}${lista && a === 'finalizar' ? ' discreto' : ''}`}
          onClick={() => void tocar(a)}
        >
          {confirmando === a ? confirmacionPanel(entidad, estado, a) : etiquetaPanel(entidad, estado, a)}
        </button>
      ))}
    </div>
  )
}

export function DetalleTanque({
  tanque,
  onNuevaOrden,
  onCargarEnvasado,
  onCerrar,
  onCambio,
}: {
  tanque: EstadoTanqueFila
  onNuevaOrden: (tanqueId: string) => void
  onCargarEnvasado: (fabricacionId: string) => void
  onCerrar: () => void
  onCambio: () => void
}) {
  const [recorrido, setRecorrido] = useState<EventoRecorrido[]>([])
  const [fabricacion, setFabricacion] = useState<DatosFabricacion | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [controlando, setControlando] = useState(false)
  const [intento, setIntento] = useState(1)
  const cerrarControl = useCallback(() => setControlando(false), [])
  const estados = estadosDe(tanque)

  useEffect(() => {
    setAviso(null)
    if (!tanque.fabricacion_id) {
      setRecorrido([])
      setFabricacion(null)
      return
    }
    let vigente = true
    const id = tanque.fabricacion_id
    // El próximo intento de control: uno más que los ya registrados.
    if (tanque.estado === 'en_control') {
      cargarControles(id).then(
        (cs) => vigente && setIntento(cs.reduce((m, c) => Math.max(m, c.intento), 0) + 1),
        () => {},
      )
    }
    Promise.all([cargarRecorrido(id), cargarFabricacion(id)]).then(
      ([r, f]) => {
        if (!vigente) return
        setRecorrido(r)
        setFabricacion(f)
      },
      (e: unknown) => vigente && setAviso(mensajeError(e).texto),
    )
    return () => {
      vigente = false
    }
    // estado incluido: al cambiar el tanque por Realtime se recarga el recorrido
  }, [tanque.fabricacion_id, tanque.estado])

  const hecho = (error: string | null) => {
    setAviso(error)
    onCambio()
  }

  return (
    <aside className="detalle-tanque" aria-label={`Tanque ${tanque.codigo}`}>
      <header className="detalle-cabecera">
        <h2>{tanque.codigo}</h2>
        {/* En la cabecera y no como renglón aparte: el panel tiene que entrar en pantalla. */}
        {fabricacion?.lote && (
          <p className="detalle-lote">
            {`Lote ${fabricacion.lote}`}
            {fabricacion.vencimiento && ` · Vence ${fechaAr(fabricacion.vencimiento)}`}
          </p>
        )}
        <button type="button" className="boton boton-sec" onClick={onCerrar} aria-label="Cerrar panel">
          ×
        </button>
      </header>
      <div className="detalle-tanque-grande">
        <Tanque
          estado={tanque.estado}
          color={tanque.color ?? undefined}
          tipo={tanque.producto_tipo}
          ancho={100}
          nivel={nivelTanque({
            estado: tanque.estado,
            capacidad: tanque.capacidad_l,
            litros: tanque.litros,
            litrosRestantes: tanque.litros_restantes,
          })}
          etiqueta={`Tanque ${tanque.codigo}`}
        />
        <dl className="detalle-datos">
          <dt>Estado</dt>
          <dd>
            <Chip estado={tanque.estado} />
          </dd>
          <dt>Capacidad</dt>
          <dd>{tanque.capacidad_l} L</dd>
          {tanque.producto && (
            <>
              <dt>Producto</dt>
              <dd>{tanque.producto}</dd>
              <dt>Litros</dt>
              <dd>
                {tanque.litros} L{tanque.litros_restantes !== null && ` · quedan ${tanque.litros_restantes} L`}
              </dd>
            </>
          )}
          {tanque.inicio && (
            <>
              <dt>Inicio</dt>
              <dd>{hora(tanque.inicio)}</dd>
            </>
          )}
        </dl>
      </div>

      {aviso && (
        <p className="aviso-panel" role="alert">
          {aviso}
        </p>
      )}

      {tanque.estado === 'libre' ? (
        <button type="button" className="boton" onClick={() => onNuevaOrden(tanque.tanque_id)}>
          Nueva orden en este tanque
        </button>
      ) : (
        <section className="detalle-seccion">
          <h3>Acciones</h3>
          {tanque.estado === 'en_control' && tanque.fabricacion_id && (
            <div className="detalle-acciones">
              <span className="detalle-etiqueta">Control</span>
              <button type="button" className="boton-mini principal" onClick={() => setControlando(true)}>
                Controlar
              </button>
            </div>
          )}
          {estados.fabricacion && tanque.fabricacion_id && (
            <Acciones
              entidad="fabricacion"
              id={tanque.fabricacion_id}
              estado={estados.fabricacion}
              titulo="Fabricación"
              onHecho={hecho}
              onCargarEnvasado={() => onCargarEnvasado(tanque.fabricacion_id!)}
            />
          )}
          {estados.envasado && tanque.envasado_id && (
            <Acciones entidad="envasado" id={tanque.envasado_id} estado={estados.envasado} titulo="Envasado" onHecho={hecho} />
          )}
        </section>
      )}

      {/* Plegada tras «Ver MP (N)» y sin lugar si no hay MP: el panel tiene que entrar en pantalla. */}
      {tanque.fabricacion_id && <TablaMp fabricacionId={tanque.fabricacion_id} estado={estados.fabricacion} plegable />}

      {tanque.fabricacion_id && (
        <div className="detalle-plegables">
          <details className="detalle-seccion detalle-operarias">
            <summary>Operarias</summary>
            {estados.envasado && tanque.envasado_id && <h4 className="detalle-etiqueta">Fabricación</h4>}
            <OperariasOrden entidad="fabricacion" id={tanque.fabricacion_id} />
            {estados.envasado && tanque.envasado_id && (
              <>
                <h4 className="detalle-etiqueta">Envasado</h4>
                <OperariasOrden entidad="envasado" id={tanque.envasado_id} />
              </>
            )}
          </details>
          <details className="detalle-seccion detalle-operarias detalle-control">
            <summary>Control</summary>
            <ControlesOrden fabricacionId={tanque.fabricacion_id} />
          </details>
        </div>
      )}

      {controlando && tanque.fabricacion_id && (
        <DialogoControl
          fabricacionId={tanque.fabricacion_id}
          esPolvo={tanque.producto_tipo === 'polvo'}
          intento={intento}
          producto={tanque.producto ?? undefined}
          onCerrar={cerrarControl}
        />
      )}

      {recorrido.length > 0 && (
        <section className="detalle-seccion">
          <h3>Recorrido</h3>
          <ol className="recorrido">
            {recorrido.map((e, i) => (
              <li key={i}>
                {`${hora(e.at)} · ${textoEventoOperaria(e) ?? `${VERBOS[e.accion] ?? e.accion}${e.entidad === 'envasado' ? ' envasado' : ''} · ${e.quien}`}`}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="detalle-seccion">
        <h3>QR para la tablet</h3>
        <QrTanque codigo={tanque.codigo} />
      </section>
    </aside>
  )
}
