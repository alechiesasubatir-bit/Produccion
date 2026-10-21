// Motor de la DEMO: hace avanzar el simulador en el navegador y avisa a las vistas en vivo.
// `velocidad` = cuántas veces más rápido que la realidad (60 = un minuto simulado por segundo).
import { crearSimulador, type Simulador } from './simulador'

export const VELOCIDADES = [0, 1, 10, 60, 300] as const

export type Motor = {
  readonly sim: Simulador
  /** Delega siempre en el simulador vigente (sobrevive a reiniciar). */
  readonly vivo: Simulador
  ahora(): number
  velocidad(): number
  setVelocidad(v: number): void
  reiniciar(): void
  suscribir(fn: () => void): () => void
  notificar(): void
  detener(): void
}

export function crearMotor(opts: { semilla?: number } = {}): Motor {
  const nuevo = () => crearSimulador({ inicio: Date.now(), semilla: opts.semilla ?? Date.now() })
  let sim = nuevo()
  let velocidad = 60
  let acumulado = 0 // minutos simulados pendientes (a velocidades bajas se juntan segundos)
  const oyentes = new Set<() => void>()
  const notificar = () => oyentes.forEach((fn) => fn())

  const reloj = setInterval(() => {
    if (velocidad === 0) return
    acumulado += velocidad / 60
    const minutos = Math.floor(acumulado + 1e-9)
    if (minutos === 0) return
    acumulado -= minutos
    sim.avanzar(minutos)
    notificar()
  }, 1000)

  return {
    get sim() {
      return sim
    },
    vivo: {
      ahora: () => sim.ahora(),
      avanzar: (n) => sim.avanzar(n),
      consultar: (t) => sim.consultar(t),
      accion: (e, id, a, emp) => sim.accion(e, id, a, emp),
      insertar: (t, d) => sim.insertar(t, d),
    },
    ahora: () => sim.ahora(),
    velocidad: () => velocidad,
    setVelocidad(v) {
      velocidad = v
      acumulado = 0
      notificar()
    },
    reiniciar() {
      sim = nuevo()
      acumulado = 0
      notificar()
    },
    suscribir(fn) {
      oyentes.add(fn)
      return () => oyentes.delete(fn)
    },
    notificar,
    detener: () => clearInterval(reloj),
  }
}

let unico: Motor | null = null

// El motor de la página (uno solo, creado al primer uso).
export function motorDemo(): Motor {
  unico ??= crearMotor()
  return unico
}
