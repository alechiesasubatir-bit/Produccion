import { useMemo, useState } from 'react'
import { esperandoFabricacion, type FilaFlujo } from '../domain/flujo'
import { confirmacionPanel, etiquetaPanel } from '../domain/tareas'
import { accionPanel } from '../lib/acciones'
import { EditarEnvasado } from './EditarEnvasado'

// Envasados del documento sin fabricación: no están en el kanban; se agrupan por granel.
export function EsperandoFabricacion({
  filas,
  habilitado,
  onCambio,
}: {
  filas: FilaFlujo[]
  habilitado: boolean
  onCambio: () => void
}) {
  const grupos = useMemo(() => {
    const por = new Map<string, FilaFlujo[]>()
    for (const f of filas.filter(esperandoFabricacion)) {
      const k = f.producto ?? 'Sin granel'
      por.set(k, [...(por.get(k) ?? []), f])
    }
    return [...por.entries()]
  }, [filas])
  const [asignando, setAsignando] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cancelar = async (id: string) => {
    if (confirmando !== id) {
      setConfirmando(id)
      return
    }
    setConfirmando(null)
    const r = await accionPanel({ entidad: 'envasado', id, accion: 'cancelar' })
    setAviso(r.ok ? null : r.texto)
    onCambio()
  }
  if (grupos.length === 0) return null
  return (
    <section className="esperando" aria-label="Esperando fabricación">
      <h2>Esperando fabricación</h2>
      {aviso && (
        <p className="aviso-panel" role="alert">
          {aviso}
        </p>
      )}
      {grupos.map(([granel, items]) => (
        <div key={granel} className="esperando-grupo" role="group" aria-label={granel}>
          <h3>{granel}</h3>
          <ul>
            {items.map((f) => (
              <li key={f.id} className="esperando-item">
                <span className="esperando-nombre">{f.descripcion ?? f.producto}</span>
                <span className="mono">{`${f.cantidad ?? '?'} × ${f.presentacion ?? '?'}`}</span>
                {(f.lote_doc ?? f.lote) && <span className="mono">{`Lote ${f.lote_doc ?? f.lote}`}</span>}
                <button type="button" className="boton-mini principal" disabled={!habilitado} onClick={() => setAsignando(f.id)}>
                  Asignar tanque
                </button>
                <button type="button" className="boton-mini discreto" disabled={!habilitado} onClick={() => setEditando(f.id)}>
                  Editar
                </button>
                <button
                  type="button"
                  className={`boton-mini${confirmando === f.id ? ' confirmar' : ''}`}
                  disabled={!habilitado}
                  onClick={() => void cancelar(f.id)}
                >
                  {confirmando === f.id ? confirmacionPanel('envasado', f.estado, 'cancelar') : etiquetaPanel('envasado', f.estado, 'cancelar')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {asignando && (
        <EditarEnvasado
          id={asignando}
          soloTanque
          onCerrar={() => setAsignando(null)}
          onGuardado={() => {
            setAsignando(null)
            onCambio()
          }}
        />
      )}
      {editando && (
        <EditarEnvasado
          id={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            onCambio()
          }}
        />
      )}
    </section>
  )
}
