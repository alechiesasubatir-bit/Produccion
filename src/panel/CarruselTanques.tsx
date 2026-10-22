import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { EstadoTanqueFila } from '../pages/ParedTanques'
import { nivelTanque } from '../domain/tanque'
import { Chip } from '../ui/Chip'
import { Tanque } from '../ui/Tanque'

// Carrusel 3D: los tanques giran en un anillo; el de adelante es el que se usa.
// Se gira arrastrando, con la rueda, con las flechas (botones o teclado) o tocando un tanque de costado.
const PASO = 30 // grados entre un tanque y el siguiente
const RADIO = 190 // px del eje al frente del anillo
const VISIBLES = 2.6 // a cuántos lugares del frente se siguen dibujando
const PX_POR_TANQUE = 90 // arrastre necesario para avanzar un tanque

const movimientoReducido = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const modulo = (a: number, n: number) => ((a % n) + n) % n

export function CarruselTanques({
  tanques,
  seleccionado,
  onElegir,
}: {
  tanques: EstadoTanqueFila[]
  seleccionado: string | null
  onElegir: (t: EstadoTanqueFila) => void
}) {
  const n = tanques.length
  // posición continua del anillo: 0 = primer tanque al frente; puede pasar de n (da vueltas)
  const [pos, setPos] = useState(0)
  const posRef = useRef(0)
  const animacion = useRef<number | null>(null)
  const arrastre = useRef<{ x: number; desde: number; movio: boolean } | null>(null)
  const recienArrastrado = useRef(false)
  const escenario = useRef<HTMLDivElement>(null)

  const mover = (p: number) => {
    posRef.current = p
    setPos(p)
  }

  const irA = useCallback((destino: number) => {
    if (animacion.current !== null) cancelAnimationFrame(animacion.current)
    animacion.current = null
    const desde = posRef.current
    if (movimientoReducido() || desde === destino) {
      mover(destino)
      return
    }
    const inicio = performance.now()
    const dura = 480
    const paso = () => {
      const t = Math.min(1, (performance.now() - inicio) / dura)
      const e = 1 - Math.pow(1 - t, 3)
      mover(desde + (destino - desde) * e)
      animacion.current = t < 1 ? requestAnimationFrame(paso) : null
    }
    animacion.current = requestAnimationFrame(paso)
  }, [])

  useEffect(() => () => {
    if (animacion.current !== null) cancelAnimationFrame(animacion.current)
  }, [])

  // la vuelta más corta hasta el índice i
  const cercano = useCallback(
    (i: number) => {
      const p = Math.round(posRef.current)
      return i + n * Math.round((p - i) / n)
    },
    [n],
  )

  // Si se elige un tanque en la pared, el carrusel gira hasta él.
  useEffect(() => {
    if (!seleccionado) return
    const i = tanques.findIndex((t) => t.tanque_id === seleccionado)
    if (i >= 0) irA(cercano(i))
  }, [seleccionado, tanques, irA, cercano])

  const girar = useCallback((pasos: number) => irA(Math.round(posRef.current) + pasos), [irA])

  // Rueda: un tanque por gesto, sin mover la página.
  useEffect(() => {
    const el = escenario.current
    if (!el) return
    let ultimo = 0
    const rueda = (e: WheelEvent) => {
      e.preventDefault()
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      const ahora = performance.now()
      if (Math.abs(d) < 4 || ahora - ultimo < 180) return
      ultimo = ahora
      girar(d > 0 ? 1 : -1)
    }
    el.addEventListener('wheel', rueda, { passive: false })
    return () => el.removeEventListener('wheel', rueda)
  }, [girar])

  if (n === 0) return null

  const frente = tanques[modulo(Math.round(pos), n)]

  return (
    <section className="carrusel" aria-roledescription="carrusel" aria-label="Carrusel de tanques">
      <div
        ref={escenario}
        className="carrusel-escenario"
        tabIndex={0}
        aria-label="Girar con las flechas; Enter usa el tanque de adelante"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') girar(-1)
          else if (e.key === 'ArrowRight') girar(1)
          else if (e.key === 'Enter') onElegir(frente)
          else return
          e.preventDefault()
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (animacion.current !== null) cancelAnimationFrame(animacion.current)
          animacion.current = null
          arrastre.current = { x: e.clientX, desde: posRef.current, movio: false }
        }}
        onPointerMove={(e) => {
          const a = arrastre.current
          if (!a) return
          const dx = e.clientX - a.x
          if (!a.movio && Math.abs(dx) > 5) {
            a.movio = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          if (a.movio) mover(a.desde - dx / PX_POR_TANQUE)
        }}
        onPointerUp={() => {
          const a = arrastre.current
          arrastre.current = null
          if (!a?.movio) return
          recienArrastrado.current = true
          setTimeout(() => (recienArrastrado.current = false), 0)
          irA(Math.round(posRef.current))
        }}
        onPointerCancel={() => {
          arrastre.current = null
          irA(Math.round(posRef.current))
        }}
      >
        <div className="carrusel-anillo" style={{ transform: `translateZ(${-RADIO}px)` }}>
          {tanques.map((t, i) => {
            // distancia al frente, del lado más corto del anillo
            const off = modulo(i - pos + n / 2, n) - n / 2
            const lejos = Math.abs(off)
            if (lejos > VISIBLES) return null
            const alFrente = lejos < 0.5
            return (
              <button
                key={t.tanque_id}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className={`carrusel-item${alFrente ? ' al-frente' : ''}${seleccionado === t.tanque_id ? ' elegida' : ''}`}
                style={
                  {
                    '--producto': t.color ?? undefined,
                    transform: `rotateY(${off * PASO}deg) translateZ(${RADIO}px)`,
                    opacity: Math.max(0, 1 - lejos * 0.3),
                    zIndex: 100 - Math.round(lejos * 10),
                  } as CSSProperties
                }
                onClick={() => {
                  if (recienArrastrado.current) return
                  if (alFrente) onElegir(t)
                  else irA(cercano(i))
                }}
              >
                <Tanque
                  estado={t.estado}
                  color={t.color ?? undefined}
                  ancho={46}
                  nivel={nivelTanque({ estado: t.estado, capacidad: t.capacidad_l, litros: t.litros, litrosRestantes: t.litros_restantes })}
                />
                <span className="carrusel-codigo">{t.codigo}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="carrusel-mando">
        <button type="button" className="carrusel-flecha" aria-label="Tanque anterior" onClick={() => girar(-1)}>
          ‹
        </button>
        <div className="carrusel-frente" aria-live="polite">
          <strong>{frente.codigo}</strong>
          <span>{frente.producto ?? 'Libre'}</span>
          <span className="carrusel-litros">{Number(frente.capacidad_l).toLocaleString('es-UY')} L</span>
        </div>
        <button type="button" className="carrusel-flecha" aria-label="Tanque siguiente" onClick={() => girar(1)}>
          ›
        </button>
      </div>
      <div className="carrusel-pie">
        <Chip estado={frente.estado} />
        <span className="carrusel-cuenta">
          {modulo(Math.round(pos), n) + 1} / {n}
        </span>
      </div>
      <button type="button" className="boton carrusel-usar" onClick={() => onElegir(frente)}>
        Usar {frente.codigo}
      </button>
    </section>
  )
}
