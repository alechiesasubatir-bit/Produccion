import { useId, type CSSProperties } from 'react'
import { burbujasTanque, olaPausada, type EstadoTanque } from '../domain/tanque'
import type { TipoProducto } from '../lib/database.types'
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
  /** Tipo del producto: en polvo se dibuja una bolsa ziplock que se llena con polvo que cae. */
  tipo?: TipoProducto | null
}

const TINTA = '#0f172a'
const VACIO = '#cbd5e1'
const MARCAS = [30, 55, 80]
const OLA_FRENTE = 'M0 3 q15 -5 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V140 H0Z'
const OLA_FONDO = 'M0 0 q15 -4 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V140 H0Z'

// Bolsa ziplock (polvo): boca abierta en y=42, fondo en y=110.
const BOLSA = 'M13 42 H47 L48 104 Q48 110 42 110 H18 Q12 110 12 104 Z'
const BOLSA_TOPE = 47 // y del polvo con la bolsa llena
const BOLSA_FONDO = 108 // y del polvo con la bolsa vacía
const MONTICULO = 'M8 2 Q30 -5 52 2 V80 H8Z'
const ESTADOS_CAE: ReadonlySet<EstadoTanque> = new Set(['fabricando', 'envasando'])

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export function Tanque({ estado, color, nivel, ancho = 60, etiqueta, tipo }: TanqueProps) {
  const id = 'tq' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const clipId = `${id}-clip`
  const brilloId = `${id}-brillo`
  const bolsaId = `${id}-bolsa`
  const granoId = `${id}-grano`
  const polvo = tipo === 'polvo'

  const ocioso = estado === 'libre' || estado === 'cola'
  const relleno = ocioso ? VACIO : (color ?? VACIO)
  const y = 6 + (1 - clamp01(nivel)) * 108
  const pausada = olaPausada(estado)
  const estiloOla = pausada ? { animationPlayState: 'paused' as const } : undefined

  const yPolvo = BOLSA_FONDO - clamp01(nivel) * (BOLSA_FONDO - BOLSA_TOPE)
  const granos = Array.from({ length: polvo && ESTADOS_CAE.has(estado) ? 14 : 0 }, (_, i) => ({
    cx: 27 + ((i * 3) % 7),
    r: 0.7 + (i % 3) * 0.3,
    delay: `${(i * 0.07).toFixed(2)}s`,
    duracion: `${(0.85 + (i % 3) * 0.12).toFixed(2)}s`,
  }))

  const burbujas = Array.from({ length: polvo ? 0 : burbujasTanque(estado) }, (_, i) => ({
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
        {polvo && (
          <>
            <clipPath id={bolsaId}>
              <path d={BOLSA} />
            </clipPath>
            <pattern id={granoId} width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".55" fill="#fff" fillOpacity=".55" />
              <circle cx="3" cy="3" r=".45" fill="#000" fillOpacity=".12" />
            </pattern>
          </>
        )}
      </defs>
      <rect x="3" y="3" width="54" height="114" rx="14" fill="#fff" />
      {estado === 'cola' && color ? (
        <rect x="3" y="3" width="54" height="114" rx="14" fill={color} opacity=".07" />
      ) : null}
      <g clipPath={`url(#${clipId})`}>
        {polvo ? (
          <g className="ziplock">
            {/* tolva: el polvo sale por arriba y cae a la bolsa */}
            <path d="M18 3 H42 L34 13 H26 Z" fill={relleno} fillOpacity=".35" stroke={TINTA} strokeOpacity=".4" strokeWidth=".8" />
            <path d={BOLSA} fill="#fff" />
            <g clipPath={`url(#${bolsaId})`}>
              <g className="polvo" style={{ transform: `translateY(${yPolvo}px)` }}>
                <path d={MONTICULO} fill={relleno} />
                <path d={MONTICULO} fill={`url(#${granoId})`} />
              </g>
            </g>
            <path d={BOLSA} fill="none" stroke={TINTA} strokeOpacity=".55" strokeWidth="1" />
            {/* cierre zip abierto: dos rieles y la solapa */}
            <line x1="13" x2="47" y1="42" y2="42" stroke={relleno} strokeWidth="1.6" />
            <line x1="13" x2="47" y1="45.5" y2="45.5" stroke={TINTA} strokeOpacity=".35" strokeWidth=".8" />
            <rect x="44" y="39.5" width="5" height="4" rx="1" fill={TINTA} fillOpacity=".55" />
            <line x1="13" x2="47" y1="49" y2="49" stroke={TINTA} strokeOpacity=".15" strokeWidth=".6" strokeDasharray="2 1.5" />
            {granos.map((g, i) => (
              <circle
                key={i}
                className="grano"
                cx={g.cx}
                cy={14}
                r={g.r}
                fill={relleno}
                style={
                  {
                    '--caida': `${yPolvo - 15}px`,
                    animationDelay: g.delay,
                    animationDuration: g.duracion,
                  } as CSSProperties
                }
              />
            ))}
          </g>
        ) : (
          <g className="liquido" style={{ transform: `translateY(${y}px)` }}>
            <path className="ola b" fill={relleno} d={OLA_FONDO} style={estiloOla} />
            <path className="ola" fill={relleno} d={OLA_FRENTE} style={estiloOla} />
          </g>
        )}
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
