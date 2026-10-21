import { useEffect, useState } from 'react'
import { ParedTanques, useTanques } from '../pages/ParedTanques'
import { DetalleTanque } from './DetalleTanque'
import { NuevaOrden } from './NuevaOrden'

export function Tanques() {
  const tanques = useTanques()
  const [elegido, setElegido] = useState<string | null>(null)
  const [nuevaEn, setNuevaEn] = useState<string | null>(null)
  // El detalle siempre muestra la fila más reciente que llegó por Realtime.
  const fila = tanques.datos.find((t) => t.tanque_id === elegido) ?? null

  useEffect(() => {
    if (!elegido) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setElegido(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [elegido])

  return (
    <div className={`tanques${fila ? ' con-detalle' : ''}`}>
      <div>
        <h1 className="titulo-panel">Tanques</h1>
        <ParedTanques
          tanques={tanques.datos}
          conectado={tanques.conectado}
          error={tanques.error}
          seleccionado={elegido}
          onElegir={(t) => setElegido(t.tanque_id)}
        />
      </div>
      {fila && (
        <DetalleTanque
          key={fila.tanque_id}
          tanque={fila}
          onCerrar={() => setElegido(null)}
          onNuevaOrden={(id) => setNuevaEn(id)}
          onCambio={() => tanques.recargar()}
        />
      )}
      <NuevaOrden
        abierta={nuevaEn !== null}
        tipoInicial="fabricacion"
        tanqueInicial={nuevaEn ?? undefined}
        onCerrar={() => setNuevaEn(null)}
        onCreada={() => {
          setNuevaEn(null)
          tanques.recargar()
        }}
      />
    </div>
  )
}
