import type { Database } from '../lib/database.types'
import { db, fetchAll } from '../lib/supabase'
import { useRealtime } from '../lib/useRealtime'
import { nivelTanque } from '../domain/tanque'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'

type EstadoTanqueFila = Database['produccion']['Views']['v_tanque_estado']['Row']

const cargarTanques = () =>
  fetchAll<EstadoTanqueFila>((from, to) => db.from('v_tanque_estado').select('*').order('orden').range(from, to))

export function ParedTanques() {
  const { datos, conectado, error } = useRealtime('v_tanque_estado', cargarTanques, ['fabricaciones', 'envasados'])

  return (
    <>
      {!conectado && (
        <div className="banda-offline" role="alert">
          Sin conexión — los datos pueden estar desactualizados.
        </div>
      )}
      {error && <p className="aviso-error">{error}</p>}
      {datos.length === 0 && !error ? (
        <p className="vacio">Todavía no hay tanques cargados.</p>
      ) : (
        <ul className="pared">
          {datos.map((t) => (
            <li key={t.tanque_id} className="pared-celda">
              <Tanque
                estado={t.estado}
                color={t.color ?? undefined}
                ancho={72}
                nivel={nivelTanque({
                  estado: t.estado,
                  capacidad: t.capacidad_l,
                  litros: t.litros,
                  litrosRestantes: t.litros_restantes,
                })}
                etiqueta={`Tanque ${t.codigo}: ${t.producto ?? 'libre'}`}
              />
              <span className="pared-codigo">{t.codigo}</span>
              <span className="pared-producto">{t.producto ?? '—'}</span>
              <Chip estado={t.estado} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
