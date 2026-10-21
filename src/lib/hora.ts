import { motorDemo } from '../demo/motor'
import { modoDemo } from './modoDemo'

const FORMATO = new Intl.DateTimeFormat('es-UY', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Montevideo',
})

export const horaMontevideo = (ms: number) => FORMATO.format(ms)

// La hora "de la planta": la real, o la simulada en la DEMO (que corre acelerada).
export const ahoraPlanta = () => (modoDemo ? motorDemo().ahora() : Date.now())
