import type { CSSProperties } from 'react'
import type { Database } from '../lib/database.types'
import { db, fetchAll } from '../lib/supabase'
import { useRealtime } from '../lib/useRealtime'
import { nivelTanque } from '../domain/tanque'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'

export type EstadoTanqueFila = Database['produccion']['Views']['v_tanque_estado']['Row']

const cargarTanques = () =>
  fetchAll<EstadoTanqueFila>((from, to) => db.from('v_tanque_estado').select('*').order('orden').range(from, to))

// Estado de los tanques en vivo (catálogo de tanques y productos incluidos).
export function useTanques() {
  return useRealtime('v_tanque_estado', cargarTanques, ['fabricaciones', 'envasados', 'tanques', 'productos'])
}

function Celda({ t }: { t: EstadoTanqueFila }) {
  return (
    <>
      <Tanque
        estado={t.estado}
        color={t.color ?? undefined}
        ancho={72}
        nivel={nivelTanque({ estado: t.estado, capacidad: t.capacidad_l, litros: t.litros, litrosRestantes: t.litros_restantes })}
        etiqueta={`Tanque ${t.codigo}: ${t.producto ?? 'libre'}`}
      />
      <span className="pared-codigo">{t.codigo}</span>
      <span className="pared-capacidad">{Number(t.capacidad_l).toLocaleString('es-UY')} L</span>
      <span className="pared-producto">{t.producto ?? '—'}</span>
      <Chip estado={t.estado} />
    </>
  )
}

export function ParedTanques({
  tanques,
  conectado,
  error,
  seleccionado,
  onElegir,
}: {
  tanques: EstadoTanqueFila[]
  conectado: boolean
  error: string | null
  seleccionado?: string | null
  onElegir?: (t: EstadoTanqueFila) => void
}) {
  return (
    <>
      {!conectado && (
        <div className="banda-offline" role="alert">
          Sin conexión — los datos pueden estar desactualizados.
        </div>
      )}
      {error && <p className="aviso-error">{error}</p>}
      {tanques.length === 0 && !error ? (
        <p className="vacio">Todavía no hay tanques cargados.</p>
      ) : (
        <ul className="pared">
          {tanques.map((t) => (
            <li
              key={t.tanque_id}
              className={`pared-celda${seleccionado === t.tanque_id ? ' elegida' : ''}`}
              style={{ '--producto': t.color ?? undefined } as CSSProperties}
            >
              {onElegir ? (
                <button type="button" className="pared-boton" aria-label={`Tanque ${t.codigo}`} onClick={() => onElegir(t)}>
                  <Celda t={t} />
                </button>
              ) : (
                <Celda t={t} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
