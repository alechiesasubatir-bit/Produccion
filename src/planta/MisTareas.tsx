import { useState } from 'react'
import type { Accion } from '../domain/acciones'
import type { Cantidad, OperariaEnOrden } from '../domain/participaciones'
import { clasificarTareas, parsearCantidad, pideCantidad, tituloTarea, unidadPorDefecto, type Tarea } from '../domain/tareas'
import { parsearPh, type FormControl } from '../domain/control'
import { registrarControl } from '../lib/acciones'
import { FormularioControl } from '../ui/FormularioControl'
import { mensajeError } from '../lib/errores'
import type { OperariaFila } from './QuienTrabaja'
import { ChecklistConsumibles } from './ChecklistConsumibles'
import { ChecklistMp } from './ChecklistMp'
import { DeclararCantidad } from './DeclararCantidad'
import { QuienControla } from './QuienControla'
import { TarjetaTarea } from './TarjetaTarea'

// Fabricación propia en curso con fórmula: lleva checklist de materias primas.
const llevaChecklist = (t: Tarea) =>
  t.entidad === 'fabricacion' && (t.estado === 'fabricando' || t.estado === 'pausada') && t.mp_total > 0

// Envasado o fraccionado en curso con consumibles: lote opcional, nunca bloquea finalizar.
const llevaConsumibles = (t: Tarea) =>
  (t.entidad === 'envasado' || t.entidad === 'fraccionado') &&
  (t.estado === 'activo' || t.estado === 'pausado') &&
  t.consumibles_total > 0

// Paso intermedio antes de mandar la acción: confirmar o declarar cantidades.
type Paso =
  | { tipo: 'confirmar'; t: Tarea; accion: Accion; texto: string }
  | { tipo: 'cantidad'; t: Tarea; accion: Accion }
  | { tipo: 'controla'; t: Tarea }
  | { tipo: 'control'; t: Tarea; firmante: string }

export function MisTareas({
  nombre,
  tareas,
  empleadoId,
  tanque,
  conectado,
  cargadoEn,
  aviso,
  recargaMp = 0,
  recargaConsumibles = 0,
  operarias = [],
  onAccion,
  onControlado,
  onSalir,
}: {
  nombre: string
  tareas: Tarea[]
  empleadoId: string
  tanque: string | null
  conectado: boolean
  cargadoEn: number
  aviso: string | null
  recargaMp?: number
  // Cambia cuando llegan datos nuevos de la base: los consumibles abiertos se vuelven a leer.
  recargaConsumibles?: number
  // Todas las operarias (para nombrar a quien marcó cada MP, aunque ya haya salido de la orden).
  operarias?: OperariaFila[]
  onAccion: (t: Tarea, a: Accion, cantidades?: Cantidad[]) => void
  onControlado?: (t: Tarea, resultado: 'aprobado' | 'rechazado') => void
  onSalir: () => void
}) {
  const { mias, enControl, enCurso, disponibles } = clasificarTareas(tareas, empleadoId, tanque)
  // MP completas según el checklist: manda sobre v_tareas hasta que Realtime la actualice.
  const [completasLocal, setCompletasLocal] = useState<Record<string, number>>({})
  const [paso, setPaso] = useState<Paso | null>(null)
  const yo: OperariaEnOrden = { empleado_id: empleadoId, nombre, desde: '' }

  const bloqueo = (t: Tarea) => {
    if (!llevaChecklist(t)) return null
    const faltan = t.mp_total - (completasLocal[t.id] ?? t.mp_completas)
    return faltan > 0 ? mensajeError({ codigo: 'MP_INCOMPLETA', detalle: String(faltan) }).texto : null
  }

  const controlar = async (p: { t: Tarea; firmante: string }, f: FormControl, resultado: 'aprobado' | 'rechazado') => {
    const r = await registrarControl({
      fabricacionId: p.t.id,
      ph: f.ph.trim() === '' ? null : parsearPh(f.ph),
      densidad: f.densidad.trim() === '' ? null : parsearCantidad(f.densidad),
      perfumeOk: f.perfumeOk === true,
      perfumeComentario: f.perfumeComentario,
      visualOk: f.visualOk === true,
      visualComentario: f.visualComentario,
      observaciones: f.observaciones,
      resultado,
      firmante: p.firmante,
    })
    if (r.ok) {
      setPaso(null)
      onControlado?.(p.t, resultado)
    }
    return r
  }

  const accionar = (t: Tarea, a: Accion) => {
    if (a === 'sumarse') return setPaso({ tipo: 'confirmar', t, accion: a, texto: `¿Sumarte a ${tituloTarea(t)}?` })
    if ((a === 'salir' || a === 'finalizar') && pideCantidad(t.entidad)) return setPaso({ tipo: 'cantidad', t, accion: a })
    if (a === 'salir') {
      return setPaso({ tipo: 'confirmar', t, accion: a, texto: 'Tus MP cargadas quedan registradas a tu nombre' })
    }
    onAccion(t, a)
  }

  const nombresDe = (t: Tarea) =>
    Object.fromEntries([
      ...operarias.map((o) => [o.empleado_id, o.nombre]),
      ...(t.operarias ?? []).map((o) => [o.empleado_id, o.nombre]),
      [empleadoId, nombre],
    ]) as Record<string, string>

  const personasDe = (t: Tarea, a: Accion): OperariaEnOrden[] => {
    const todas = t.operarias ?? []
    if (a === 'salir') return [todas.find((o) => o.empleado_id === empleadoId) ?? yo]
    return todas.length > 0 ? todas : [yo]
  }

  return (
    <section className="mis-tareas">
      {!conectado && (
        <div className="banda-offline banda-planta" role="status">
          Sin conexión — no se pueden registrar acciones.
        </div>
      )}
      <header className="mis-tareas-cabecera">
        <h1 className="titulo-planta">Hola, {nombre}</h1>
        <button type="button" className="boton boton-sec" onClick={onSalir}>
          No soy yo
        </button>
      </header>
      {aviso && (
        <p className="aviso-planta" role="alert">
          {aviso}
        </p>
      )}
      <section className="lista-tareas" aria-label="Mis tareas">
        <h2>Mías</h2>
        {mias.length === 0 ? (
          <p className="vacio">No tenés tareas en curso.</p>
        ) : (
          mias.map((t) => (
            <TarjetaTarea
              key={t.id}
              tarea={t}
              disponible={false}
              empleadoId={empleadoId}
              habilitado={conectado}
              cargadoEn={cargadoEn}
              onAccion={(a) => accionar(t, a)}
              bloqueoFinalizar={bloqueo(t)}
              checklist={
                llevaConsumibles(t) ? (
                  <ChecklistConsumibles
                    entidad={t.entidad as 'envasado' | 'fraccionado'}
                    entidadId={t.id}
                    empleadoId={empleadoId}
                    habilitado={conectado}
                    nombres={nombresDe(t)}
                    recarga={recargaConsumibles}
                  />
                ) : (
                  llevaChecklist(t) && (
                  <ChecklistMp
                    fabricacionId={t.id}
                    empleadoId={empleadoId}
                    habilitado={conectado}
                    recarga={recargaMp}
                    nombres={nombresDe(t)}
                    onCambio={(n) => setCompletasLocal((c) => (c[t.id] === n ? c : { ...c, [t.id]: n }))}
                  />
                  )
                )
              }
            />
          ))
        )}
      </section>
      {enControl.length > 0 && (
        <section className="lista-tareas" aria-label="En control">
          <h2>En control</h2>
          {enControl.map((t) => (
            <TarjetaTarea
              key={t.id}
              tarea={t}
              disponible={false}
              empleadoId={empleadoId}
              habilitado={conectado}
              cargadoEn={cargadoEn}
              onAccion={() => {}}
              onControlar={() => setPaso({ tipo: 'controla', t })}
            />
          ))}
        </section>
      )}
      {enCurso.length > 0 && (
        <section className="lista-tareas" aria-label="En curso para sumarme">
          <h2>En curso — sumarme</h2>
          {enCurso.map((t) => (
            <TarjetaTarea
              key={t.id}
              tarea={t}
              disponible={false}
              enCurso
              empleadoId={empleadoId}
              habilitado={conectado}
              cargadoEn={cargadoEn}
              onAccion={(a) => accionar(t, a)}
            />
          ))}
        </section>
      )}
      <section className="lista-tareas" aria-label="Disponibles para tomar">
        <h2>Disponibles</h2>
        {disponibles.length === 0 ? (
          <p className="vacio">No hay tareas para tomar.</p>
        ) : (
          disponibles.map((t) => (
            <TarjetaTarea
              key={t.id}
              tarea={t}
              disponible
              habilitado={conectado}
              cargadoEn={cargadoEn}
              onAccion={(a) => accionar(t, a)}
            />
          ))
        )}
      </section>
      {paso?.tipo === 'cantidad' && (
        <DeclararCantidad
          personas={personasDe(paso.t, paso.accion)}
          unidadInicial={unidadPorDefecto(paso.t)}
          titulo={paso.accion === 'salir' ? '¿Cuánto envasaste?' : '¿Cuánto envasó cada una?'}
          onConfirmar={(c) => {
            setPaso(null)
            onAccion(paso.t, paso.accion, c)
          }}
          onCancelar={() => setPaso(null)}
        />
      )}
      {paso?.tipo === 'controla' && (
        <QuienControla
          onElegir={(id) => setPaso({ tipo: 'control', t: paso.t, firmante: id })}
          onCancelar={() => setPaso(null)}
        />
      )}
      {paso?.tipo === 'control' && (
        <FormularioControl
          esPolvo={paso.t.producto_tipo === 'polvo'}
          intento={paso.t.control_intento ?? 1}
          producto={paso.t.producto ?? undefined}
          onAprobar={(f) => controlar(paso, f, 'aprobado')}
          onRechazar={(f) => controlar(paso, f, 'rechazado')}
          onCancelar={() => setPaso(null)}
        />
      )}
      {paso?.tipo === 'confirmar' && (
        <div className="declarar" role="dialog" aria-label="Confirmar">
          <p className="declarar-titulo">{paso.texto}</p>
          <button
            type="button"
            className="boton"
            onClick={() => {
              setPaso(null)
              onAccion(paso.t, paso.accion)
            }}
          >
            Confirmar
          </button>
          <button type="button" className="boton boton-sec" onClick={() => setPaso(null)}>
            Volver
          </button>
        </div>
      )}
    </section>
  )
}
