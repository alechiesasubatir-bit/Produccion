import { animate } from 'motion'
import { useEffect, useRef, useState } from 'react'

function sinMovimiento(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Número que se desliza hasta su valor nuevo (instantáneo con reduced motion).
export function Contador({ valor }: { valor: number }) {
  const [mostrado, setMostrado] = useState(valor)
  const previo = useRef(valor)
  useEffect(() => {
    const desde = previo.current
    previo.current = valor
    if (sinMovimiento() || desde === valor) {
      setMostrado(valor)
      return
    }
    const control = animate(desde, valor, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setMostrado(Math.round(v)),
    })
    return () => control.stop()
  }, [valor])
  return <b className="kpi-valor">{mostrado.toLocaleString('es-UY')}</b>
}

export function KpisFlujo({ kpis }: { kpis: { cola: number; fabricando: number; envasando: number; litrosHoy: number } }) {
  const items: Array<[number, string]> = [
    [kpis.cola, 'en cola'],
    [kpis.fabricando, 'fabricando'],
    [kpis.envasando, 'envasando'],
    [kpis.litrosHoy, 'litros hoy'],
  ]
  return (
    <dl className="kpis">
      {items.map(([v, etiqueta]) => (
        <div key={etiqueta} className="kpi">
          <dd>
            <Contador valor={v} />
          </dd>
          <dt>{etiqueta}</dt>
        </div>
      ))}
    </dl>
  )
}
