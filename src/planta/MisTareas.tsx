import type { Accion } from '../domain/acciones'
import { clasificarTareas, type Tarea } from '../domain/tareas'
import { TarjetaTarea } from './TarjetaTarea'

export function MisTareas({
  nombre,
  tareas,
  empleadoId,
  tanque,
  conectado,
  cargadoEn,
  aviso,
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
  onAccion: (t: Tarea, a: Accion) => void
  onSalir: () => void
}) {
  const { mias, disponibles } = clasificarTareas(tareas, empleadoId, tanque)

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
