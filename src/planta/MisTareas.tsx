import { useState } from 'react'
import type { Accion } from '../domain/acciones'
import { clasificarTareas, type Tarea } from '../domain/tareas'
import { mensajeError } from '../lib/errores'
import { ChecklistMp } from './ChecklistMp'
import { TarjetaTarea } from './TarjetaTarea'

// Fabricación propia en curso con fórmula: lleva checklist de materias primas.
const llevaChecklist = (t: Tarea) =>
  t.entidad === 'fabricacion' && (t.estado === 'fabricando' || t.estado === 'pausada') && t.mp_total > 0

export function MisTareas({
  nombre,
  tareas,
  empleadoId,
  tanque,
  conectado,
  cargadoEn,
  aviso,
  recargaMp = 0,
  onAccion,
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
  onAccion: (t: Tarea, a: Accion) => void
  onSalir: () => void
}) {
  const { mias, disponibles } = clasificarTareas(tareas, empleadoId, tanque)
  // MP completas según el checklist: manda sobre v_tareas hasta que Realtime la actualice.
  const [completasLocal, setCompletasLocal] = useState<Record<string, number>>({})

  const bloqueo = (t: Tarea) => {
    if (!llevaChecklist(t)) return null
    const faltan = t.mp_total - (completasLocal[t.id] ?? t.mp_completas)
    return faltan > 0 ? mensajeError({ codigo: 'MP_INCOMPLETA', detalle: String(faltan) }).texto : null
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
        <h2>Mis tareas</h2>
        {mias.length === 0 ? (
          <p className="vacio">No tenés tareas en curso.</p>
        ) : (
          mias.map((t) => (
            <TarjetaTarea
              key={t.id}
              tarea={t}
              disponible={false}
              habilitado={conectado}
              cargadoEn={cargadoEn}
              onAccion={(a) => onAccion(t, a)}
              bloqueoFinalizar={bloqueo(t)}
              checklist={
                llevaChecklist(t) && (
                  <ChecklistMp
                    fabricacionId={t.id}
                    empleadoId={empleadoId}
                    habilitado={conectado}
                    recarga={recargaMp}
                    onCambio={(n) => setCompletasLocal((c) => (c[t.id] === n ? c : { ...c, [t.id]: n }))}
                  />
                )
              }
            />
          ))
        )}
      </section>
      <section className="lista-tareas" aria-label="Disponibles para tomar">
        <h2>Disponibles para tomar</h2>
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
              onAccion={(a) => onAccion(t, a)}
            />
          ))
        )}
      </section>
    </section>
  )
}
