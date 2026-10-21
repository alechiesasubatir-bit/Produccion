import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ParedTanques, useTanques } from '../pages/ParedTanques'
import { DetalleTanque } from './DetalleTanque'
import { NuevaOrden } from './NuevaOrden'

export function Tanques() {
  const tanques = useTanques()
  const [params] = useSearchParams()
  const [elegido, setElegido] = useState<string | null>(null)
  // ?tanque=T-01 (desde el historial): elegirlo cuando lleguen los datos.
  // Se aplica una sola vez: después, cerrar el panel tiene que cerrarlo.
  const codigoInicial = params.get('tanque')
  const aplicado = useRef(false)
  useEffect(() => {
    if (!codigoInicial || aplicado.current) return
    const t = tanques.datos.find((x) => x.codigo === codigoInicial)
    if (t) {
      aplicado.current = true
      setElegido(t.tanque_id)
    }
  }, [codigoInicial, tanques.datos])
  const [nuevaEn, setNuevaEn] = useState<string | null>(null)
  // "Cargar envasado" desde el panel del tanque: Nueva orden → Envasado con esa fabricación.
  const [envasarFab, setEnvasarFab] = useState<string | null>(null)
  const cerrarNueva = () => {
    setNuevaEn(null)
    setEnvasarFab(null)
  }
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
          onCargarEnvasado={(fabId) => setEnvasarFab(fabId)}
          onCambio={() => tanques.recargar()}
        />
      )}
      <NuevaOrden
        abierta={nuevaEn !== null || envasarFab !== null}
        tipoInicial={envasarFab ? 'envasado' : 'fabricacion'}
        tanqueInicial={nuevaEn ?? undefined}
        fabricacionInicial={envasarFab ?? undefined}
        onCerrar={cerrarNueva}
        onCreada={() => {
          cerrarNueva()
          tanques.recargar()
        }}
      />
    </div>
  )
}
