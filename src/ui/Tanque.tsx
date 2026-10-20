import { useId } from 'react'
import { burbujasTanque, olaPausada, type EstadoTanque } from '../domain/tanque'
import './Tanque.css'

export type TanqueProps = {
  estado: EstadoTanque
  /** Color del producto; se ignora si el tanque está libre o en cola. */
  color?: string
  /** Nivel ya calculado, 0..1 (ver `nivelTanque`). */
  nivel: number
  /** Ancho en px; el alto es el doble. */
  ancho?: number
  etiqueta?: string
}

const TINTA = '#0f172a'
const VACIO = '#cbd5e1'
const MARCAS = [30, 55, 80]
const OLA_FRENTE = 'M0 3 q15 -5 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V140 H0Z'
const OLA_FONDO = 'M0 0 q15 -4 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V140 H0Z'

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export function Tanque({ estado, color, nivel, ancho = 60, etiqueta }: TanqueProps) {
  const id = 'tq' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const clipId = `${id}-clip`
  const brilloId = `${id}-brillo`

  const ocioso = estado === 'libre' || estado === 'cola'
  const relleno = ocioso ? VACIO : (color ?? VACIO)
  const y = 6 + (1 - clamp01(nivel)) * 108
  const pausada = olaPausada(estado)
  const estiloOla = pausada ? { animationPlayState: 'paused' as const } : undefined

  const burbujas = Array.from({ length: burbujasTanque(estado) }, (_, i) => ({
    cx: 12 + ((i * 37) % 36),
    cy: 110 - (i % 2) * 6,
    r: 1.2 + (i % 3) * 0.7,
    delay: `${(i * 0.43).toFixed(2)}s`,
    duracion: `${(2 + (i % 3) * 0.6).toFixed(1)}s`,
  }))

  return (
    <svg
      className="tanque"
      width={ancho}
      height={ancho * 2}
      viewBox="0 0 60 120"
      role="img"
      aria-label={etiqueta ?? `Tanque ${estado}`}
      data-estado={estado}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="3" y="3" width="54" height="114" rx="14" />
        </clipPath>
        <linearGradient id={brilloId} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".18" stopColor="#fff" stopOpacity=".45" />
          <stop offset=".3" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="54" height="114" rx="14" fill="#fff" />
      {estado === 'cola' && color ? (
        <rect x="3" y="3" width="54" height="114" rx="14" fill={color} opacity=".07" />
      ) : null}
      <g clipPath={`url(#${clipId})`}>
        <g className="liquido" style={{ transform: `translateY(${y}px)` }}>
          <path className="ola b" fill={relleno} d={OLA_FONDO} style={estiloOla} />
          <path className="ola" fill={relleno} d={OLA_FRENTE} style={estiloOla} />
        </g>
        {burbujas.map((b, i) => (
          <circle
            key={i}
            className="burbuja"
            cx={b.cx}
            cy={b.cy}
            r={b.r}
            fill="#fff"
            style={{ animationDelay: b.delay, animationDuration: b.duracion }}
          />
        ))}
        <rect x="3" y="3" width="54" height="114" fill={`url(#${brilloId})`} />
      </g>
      <rect
        className="vidrio"
        x="3"
        y="3"
        width="54"
        height="114"
        rx="14"
        fill="none"
        stroke={ocioso ? VACIO : TINTA}
        strokeWidth="1.6"
        strokeDasharray={ocioso ? '4 3' : undefined}
      />
      {MARCAS.map((my) => (
        <line key={my} x1="57" x2="51" y1={my} y2={my} stroke={TINTA} strokeOpacity=".35" />
      ))}
    </svg>
  )
}
