import { motion, useReducedMotion } from 'motion/react'
import './planta.css'
import type { Database } from '../lib/database.types'
import { estadoOperaria, type Tarea } from '../domain/tareas'

export type OperariaFila = Database['produccion']['Views']['v_operarias']['Row']

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function Avatar({ operaria, tam = 72 }: { operaria: OperariaFila; tam?: number }) {
  return operaria.foto_url ? (
    <img className="avatar" src={operaria.foto_url} alt="" width={tam} height={tam} />
  ) : (
    <span className="avatar" style={{ width: tam, height: tam, background: operaria.color_avatar ?? 'var(--tinta-2)' }} aria-hidden="true">
      {iniciales(operaria.nombre)}
    </span>
  )
}

export function QuienTrabaja({
  operarias,
  tareas,
  onElegir,
}: {
  operarias: OperariaFila[]
  tareas: Tarea[]
  onElegir: (o: OperariaFila) => void
}) {
  const sinMovimiento = useReducedMotion()
  const ordenadas = [...operarias].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  return (
    <section className="quien">
      <h1 className="titulo-planta">¿Quién trabaja?</h1>
      {ordenadas.length === 0 ? (
        <p className="vacio">No hay operarias habilitadas. Avisá a la encargada.</p>
      ) : (
        <div className="quien-grilla">
          {ordenadas.map((o, i) => {
            const estado = estadoOperaria(tareas, o.empleado_id)
            return (
              <motion.button
                key={o.empleado_id}
                type="button"
                className="quien-boton"
                onClick={() => onElegir(o)}
                initial={sinMovimiento ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="quien-avatar">
                  <Avatar operaria={o} />
                  {estado && <i className={`punto punto-${estado}`} aria-label={estado === 'trabajando' ? 'trabajando' : 'en pausa'} />}
                </span>
                <span className="quien-nombre">{o.nombre}</span>
              </motion.button>
            )
          })}
        </div>
      )}
    </section>
  )
}
