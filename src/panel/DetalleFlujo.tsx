import { useState, type RefObject } from 'react'
import { accionesPosibles, type Accion } from '../domain/acciones'
import type { FilaFlujo } from '../domain/flujo'
import { confirmacionPanel, etiquetaPanel, tituloTarea } from '../domain/tareas'
import { Cronometro } from '../planta/TarjetaTarea'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'
import { ControlesOrden } from './ControlesOrden'
import { Modal } from './Modal'
import { OperariasOrden } from './OperariasOrden'
import { TablaMp } from './TablaMp'
import { estadoMini, nivelMini, nombresOperarias } from './flujoMini'

const CONFIRMAR: Accion[] = ['cancelar', 'finalizar']

const hora = (at: string) =>
  new Date(at).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Montevideo' })

const chipDe = (f: FilaFlujo) => (f.entidad === 'fraccionado' && f.estado === 'activo' ? 'fraccionado' : f.estado)

// Todo lo de una orden del flujo: datos, acciones, envasados cargados, operarias, MP y control.
// La tarjeta queda chica; esto se abre al tocarla.
export function DetalleFlujo({
  fila,
  envasados,
  nombres,
  habilitado,
  cargadoEn,
  volverA,
  onAccion,
  onControlar,
  onCargarEnvasado,
  onEditar,
  onCerrar,
}: {
  fila: FilaFlujo
  /** Envasados cargados sobre esta fabricación (vacío para envasados y fraccionados). */
  envasados: FilaFlujo[]
  nombres: Map<string, string>
  habilitado: boolean
  cargadoEn: number
  volverA: RefObject<HTMLElement | null>
  onAccion: (a: Accion) => void
  onControlar?: () => void
  onCargarEnvasado?: () => void
  onEditar?: () => void
  onCerrar: () => void
}) {
  const [confirmando, setConfirmando] = useState<Accion | null>(null)
  const acciones = accionesPosibles(fila.entidad, fila.estado, 'panel')
  const esFab = fila.entidad === 'fabricacion'
  const lista = esFab && fila.estado === 'para_envasar' && !!onCargarEnvasado
  const titulo = tituloTarea(fila)

  const tocar = (a: Accion) => {
    if (CONFIRMAR.includes(a) && confirmando !== a) {
      setConfirmando(a)
      return
    }
    setConfirmando(null)
    onAccion(a)
  }

  const hayAcciones = acciones.length > 0 || !!onControlar || lista || !!onEditar

  return (
    <Modal titulo={titulo} etiqueta={`Detalle de ${titulo}`} clase="modal-flujo" volverA={volverA} onCerrar={onCerrar}>
      <div className="detalle-tanque-grande">
        {fila.tanque_codigo && (
          <Tanque
            estado={estadoMini(fila)}
            color={fila.color ?? undefined}
            tipo={fila.producto_tipo}
            nivel={nivelMini(fila)}
            ancho={72}
            etiqueta={`Tanque ${fila.tanque_codigo}`}
          />
        )}
        <dl className="detalle-datos">
          <dt>Estado</dt>
          <dd className="df-estado">
            <Chip estado={chipDe(fila)} />
            <Cronometro tarea={fila} cargadoEn={cargadoEn} />
          </dd>
          {fila.tanque_codigo && (
            <>
              <dt>Tanque</dt>
              <dd className="mono">{fila.tanque_codigo}</dd>
            </>
          )}
          {fila.lote && (
            <>
              <dt>Lote</dt>
              <dd className="mono">{fila.lote}</dd>
            </>
          )}
          {esFab && fila.litros !== null && (
            <>
              <dt>Litros</dt>
              <dd>
                {fila.litros} L{fila.litros_restantes !== null && ` · quedan ${fila.litros_restantes} L`}
              </dd>
            </>
          )}
          {fila.entidad === 'envasado' && (
            <>
              <dt>Envasado</dt>
              <dd>
                {fila.cantidad ?? '?'} × {fila.presentacion ?? '?'}
              </dd>
            </>
          )}
          {fila.inicio && (
            <>
              <dt>Inicio</dt>
              <dd>{hora(fila.inicio)}</dd>
            </>
          )}
          {fila.control_rechazo && (
            <>
              <dt>Rechazo</dt>
              <dd>{fila.control_rechazo}</dd>
            </>
          )}
        </dl>
      </div>

      {!habilitado && <p className="df-aviso">Sin conexión: las acciones vuelven cuando se reconecte.</p>}

      {hayAcciones && (
        <section className="detalle-seccion" aria-label="Acciones">
          <h3>Acciones</h3>
          <div className="detalle-acciones">
            {onControlar && (
              <button type="button" className="boton-mini principal" disabled={!habilitado} onClick={onControlar}>
                Controlar
              </button>
            )}
            {lista && (
              <button type="button" className="boton-mini principal" disabled={!habilitado} onClick={onCargarEnvasado}>
                Cargar envasado
              </button>
            )}
            {onEditar && (
              <button type="button" className="boton-mini discreto" disabled={!habilitado} onClick={onEditar}>
                Editar
              </button>
            )}
            {acciones.map((a) => (
              <button
                key={a}
                type="button"
                className={`boton-mini${confirmando === a ? ' confirmar' : ''}${lista && a === 'finalizar' ? ' discreto' : ''}`}
                disabled={!habilitado}
                onClick={() => tocar(a)}
              >
                {confirmando === a ? confirmacionPanel(fila.entidad, fila.estado, a) : etiquetaPanel(fila.entidad, fila.estado, a)}
              </button>
            ))}
          </div>
        </section>
      )}

      {esFab && (
        <section className="detalle-seccion" aria-label="Envasados cargados">
          <h3>Envasados cargados</h3>
          {envasados.length === 0 ? (
            <p className="operarias-vacio">Todavía no se cargó ningún envasado.</p>
          ) : (
            <ul className="df-envasados">
              {envasados.map((e) => {
                const quienes = nombresOperarias(e, nombres)
                return (
                  <li key={e.id}>
                    <span className="df-env-nombre">{tituloTarea(e)}</span>
                    <Chip estado={chipDe(e)} />
                    {quienes.length > 0 && <span className="df-env-quien">{quienes.join(' · ')}</span>}
                    <Cronometro tarea={e} cargadoEn={cargadoEn} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <section className="detalle-seccion" aria-label="Operarias">
        <h3>Operarias</h3>
        <OperariasOrden entidad={fila.entidad} id={fila.id} />
      </section>

      {esFab && (
        <div className="detalle-plegables">
          <TablaMp fabricacionId={fila.id} estado={fila.estado} plegable />
          <details className="detalle-seccion detalle-operarias detalle-control">
            <summary>Control</summary>
            <ControlesOrden fabricacionId={fila.id} />
          </details>
        </div>
      )}
    </Modal>
  )
}
