import { useEffect, useRef } from 'react'
import { sonarAlerta, sonidoActivado } from './sonido'

// Suena una vez cuando aparece una alerta activa que no estaba. Las que ya estaban al
// abrir el panel no suenan: la línea base se toma con la primera carga (`listo`), no con la
// lista vacía inicial.
export function useAvisoSonoro(idsActivas: string[], listo: boolean): void {
  const vistas = useRef<Set<string> | null>(null)
  const clave = idsActivas.join(',')

  useEffect(() => {
    if (!listo) return
    const ids = clave ? clave.split(',') : []
    if (vistas.current === null) {
      vistas.current = new Set(ids)
      return
    }
    const nuevas = ids.filter((id) => !vistas.current!.has(id))
    ids.forEach((id) => vistas.current!.add(id))
    if (nuevas.length > 0 && sonidoActivado()) sonarAlerta()
  }, [clave, listo])
}
