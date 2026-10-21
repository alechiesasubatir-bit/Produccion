import { useEffect, useReducer } from 'react'
import { horaMontevideo } from '../lib/hora'
import { motorDemo, VELOCIDADES } from './motor'

const ETIQUETA = (v: number) => (v === 0 ? 'Pausa' : `${v}×`)

// Controles de la DEMO en el encabezado: aviso, hora simulada, velocidad y reinicio.
export function BarraDemo() {
  const motor = motorDemo()
  const [, refrescar] = useReducer((n: number) => n + 1, 0)
  useEffect(() => motor.suscribir(refrescar), [motor])
  const actual = motor.velocidad()

  return (
    <div className="barra-demo">
      <span className="demo-sello">DEMO · datos de prueba</span>
      <span className="demo-hora" role="timer" aria-label="Hora simulada">
        {horaMontevideo(motor.ahora())}
      </span>
      <div className="segmentos demo-velocidad" role="group" aria-label="Velocidad de la simulación">
        {VELOCIDADES.map((v) => (
          <button
            key={v}
            type="button"
            className="segmento"
            aria-pressed={actual === v}
            onClick={() => {
              motor.setVelocidad(v)
              refrescar()
            }}
          >
            {ETIQUETA(v)}
          </button>
        ))}
      </div>
      <button type="button" className="boton boton-sec" onClick={() => motor.reiniciar()}>
        Reiniciar
      </button>
    </div>
  )
}
