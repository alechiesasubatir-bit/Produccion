import { useEnLinea } from '../lib/useEnLinea'

// Punto «en vivo» de la barra superior: late con conexión y se apaga sin ella.
// En la demo (forzarVivo) siempre está en vivo: no depende de la red. Sin rol de región viva: el corte
// ya lo anuncia la banda «sin conexión».
export function PulsoVivo({ forzarVivo = false }: { forzarVivo?: boolean }) {
  const enLinea = useEnLinea()
  const vivo = forzarVivo || enLinea
  return (
    <span className={`pulso-vivo${vivo ? '' : ' apagado'}`}>
      {vivo ? 'En vivo' : 'Desconectado'}
    </span>
  )
}
