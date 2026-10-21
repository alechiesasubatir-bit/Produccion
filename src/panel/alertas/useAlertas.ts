import { useEffect, useMemo, useState } from 'react'
import { separarAlertas, type Alerta } from '../../domain/alertas'
import { useRealtime } from '../../lib/useRealtime'
import { cargarAlertas } from './datosAlertas'

const MINUTO = 60_000

export function useAlertas(): { todas: Alerta[]; activas: Alerta[]; cargado: boolean; recargar: () => void } {
  const { datos, cargado, recargar } = useRealtime('alertas', cargarAlertas, ['alertas'])
  // Re-evaluar cada minuto: un "posponer" vencido vuelve a activas sin que cambie la base.
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), MINUTO)
    return () => clearInterval(id)
  }, [])
  const activas = useMemo(() => separarAlertas(datos, ahora).activas, [datos, ahora])
  return { todas: datos, activas, cargado, recargar }
}
