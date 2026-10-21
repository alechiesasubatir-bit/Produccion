// Simulador de planta para la DEMO: una "base de datos" en memoria que avanza sola por minutos
// simulados. Devuelve las mismas vistas que Supabase (v_flujo, v_tanque_estado, …) para que la app
// real las muestre sin cambios. Las transiciones son las del dominio (accionesPosibles).
import { accionesPosibles, type Accion, type Entidad } from '../domain/acciones'
import type { CodigoError } from '../lib/errores'
import {
  LITROS_ENV_POR_MIN,
  LITROS_FAB_POR_MIN,
  OPERARIAS,
  PRESENTACIONES,
  PRODUCTOS,
  PRODUCTOS_FRACCIONADO,
  TANQUES,
  UNIDADES_FRAC_POR_MIN,
} from './catalogo'

const MIN = 60_000
const VENTANA_TERMINADAS = 3 * 60 * MIN

type Base = {
  id: string
  estado: string
  creado: number
  inicio: number | null
  fin: number | null
  efectivos: number
  reanudarEn: number | null
}
type Fab = Base & { tanque_id: string; producto_id: string; litros: number; lote: string; operaria: string | null; envasado: number }
type Env = Base & { fabricacion_id: string; presentacion_id: string; cantidad: number; hechas: number; operaria_1: string | null; operaria_2: string | null }
type Frac = Base & { producto_id: string | null; descripcion: string | null; presentacion_id: string; cantidad: number; hechas: number; lote: string | null; operaria: string | null }
type Evento = { entidad: Entidad; entidad_id: string; accion: string; at: string; empleado_id: string | null }

export type ResultadoAccion = { ok: true; fabricacion_cerrada: boolean } | { ok: false; codigo: CodigoError; detalle: string }
export type Fila = Record<string, unknown>

export type Simulador = {
  ahora(): number
  avanzar(minutos: number): void
  consultar(tabla: string): Fila[]
  accion(entidad: Entidad, id: string, accion: Accion, empleadoId?: string | null): ResultadoAccion
  insertar(tabla: string, datos: Fila): void
}

// PRNG determinista (mulberry32): la misma semilla da la misma película.
function azarCon(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ABIERTA_FAB = new Set(['cola', 'fabricando', 'pausada', 'para_envasar'])
const CORRIENDO = new Set(['fabricando', 'activo'])
const PAUSA = new Set(['pausada', 'pausado'])
const ABIERTA_TAREA = new Set(['cola', 'activo', 'pausado'])

export function crearSimulador(opts: { inicio: number; semilla?: number; calentar?: number; autonomo?: boolean }): Simulador {
  const azar = azarCon(opts.semilla ?? Date.now())
  const autonomo = opts.autonomo ?? true
  const calentar = opts.calentar ?? 180
  let t = opts.inicio - calentar * MIN
  let sec = 0
  let numLote = 2200
  const fabs: Fab[] = []
  const envs: Env[] = []
  const fracs: Frac[] = []
  const eventos: Evento[] = []

  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
  const elegir = <T,>(lista: T[]): T => lista[Math.floor(azar() * lista.length)]
  const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1))
  const nuevoId = (p: string) => `${p}${++sec}`
  const evento = (entidad: Entidad, id: string, accion: string, empleado: string | null = null) =>
    eventos.push({ entidad, entidad_id: id, accion, at: new Date(t).toISOString(), empleado_id: empleado })

  const producto = (id: string | null) => [...PRODUCTOS, ...PRODUCTOS_FRACCIONADO].find((p) => p.id === id)
  const presentacion = (id: string) => PRESENTACIONES.find((p) => p.id === id)!
  const tanque = (id: string) => TANQUES.find((x) => x.id === id)!
  const fabDe = (id: string) => fabs.find((f) => f.id === id)!

  const ocupadas = () => {
    const s = new Set<string>()
    for (const f of fabs) if ((CORRIENDO.has(f.estado) || PAUSA.has(f.estado)) && f.operaria) s.add(f.operaria)
    for (const e of envs) if ((CORRIENDO.has(e.estado) || PAUSA.has(e.estado)) && e.operaria_1) s.add(e.operaria_1)
    for (const x of fracs) if ((CORRIENDO.has(x.estado) || PAUSA.has(x.estado)) && x.operaria) s.add(x.operaria)
    return s
  }
  const operariaLibre = (): string | null => {
    const o = ocupadas()
    const libres = OPERARIAS.filter((x) => !o.has(x.empleado_id))
    return libres.length ? elegir(libres).empleado_id : null
  }
  const fabAbierta = (tanqueId: string) => fabs.find((f) => f.tanque_id === tanqueId && ABIERTA_FAB.has(f.estado))
  const enProceso = (f: Fab) =>
    envs.filter((e) => e.fabricacion_id === f.id && e.estado !== 'finalizado' && e.estado !== 'cancelado')
      .reduce((s, e) => s + e.hechas * presentacion(e.presentacion_id).litros_equiv, 0)
  const restante = (f: Fab) => Math.max(0, Math.round(f.litros - f.envasado - enProceso(f)))

  // ---------- altas ----------
  function insertar(tabla: string, d: Fila) {
    const base = { estado: 'cola', creado: t, inicio: null, fin: null, efectivos: 0, reanudarEn: null }
    if (tabla === 'fabricaciones') {
      const tanqueId = String(d.tanque_id)
      if (fabAbierta(tanqueId)) throw new Error('duplicate key value violates unique constraint "fabricaciones_tanque_abierta_uk"')
      const f: Fab = {
        ...base,
        id: nuevoId('df'),
        tanque_id: tanqueId,
        producto_id: String(d.producto_id),
        litros: Number(d.litros),
        lote: d.lote ? String(d.lote) : `L-${++numLote}`,
        operaria: (d.operaria_id as string | null) ?? null,
        envasado: 0,
      }
      fabs.push(f)
      evento('fabricacion', f.id, 'crear')
    } else if (tabla === 'envasados') {
      const e: Env = {
        ...base,
        id: nuevoId('de'),
        fabricacion_id: String(d.fabricacion_id),
        presentacion_id: String(d.presentacion_id),
        cantidad: Number(d.cantidad),
        hechas: 0,
        operaria_1: (d.operaria_1 as string | null) ?? null,
        operaria_2: (d.operaria_2 as string | null) ?? null,
      }
      envs.push(e)
      evento('envasado', e.id, 'crear')
    } else if (tabla === 'fraccionados') {
      const x: Frac = {
        ...base,
        id: nuevoId('dx'),
        producto_id: (d.producto_id as string | null) ?? null,
        descripcion: (d.descripcion as string | null) ?? null,
        presentacion_id: String(d.presentacion_id),
        cantidad: Number(d.cantidad),
        hechas: 0,
        lote: (d.lote as string | null) ?? `L-${++numLote}`,
        operaria: (d.operaria_id as string | null) ?? null,
      }
      fracs.push(x)
      evento('fraccionado', x.id, 'crear')
    } else {
      throw new Error(`La demo no guarda en ${tabla}`)
    }
  }

  // ---------- acciones ----------
  function cerrarSiCorresponde(f: Fab): boolean {
    if (f.estado === 'para_envasar' && f.envasado >= f.litros - 0.5) {
      f.estado = 'finalizada'
      f.fin = t
      evento('fabricacion', f.id, 'finalizar')
      return true
    }
    return false
  }

  function terminarTarea(entidad: Entidad, x: Env | Frac): boolean {
    x.estado = 'finalizado'
    x.fin = t
    x.hechas = x.cantidad
    if (entidad !== 'envasado') return false
    const e = x as Env
    const f = fabDe(e.fabricacion_id)
    f.envasado += e.cantidad * presentacion(e.presentacion_id).litros_equiv
    return cerrarSiCorresponde(f)
  }

  function accion(entidad: Entidad, id: string, a: Accion, empleadoId: string | null = null): ResultadoAccion {
    const lista: Base[] = entidad === 'fabricacion' ? fabs : entidad === 'envasado' ? envs : fracs
    const x = lista.find((y) => y.id === id)
    if (!x) return { ok: false, codigo: 'NO_ENCONTRADO', detalle: id }
    if (!accionesPosibles(entidad, x.estado, 'panel').includes(a)) {
      return { ok: false, codigo: 'TRANSICION_INVALIDA', detalle: `${x.estado} → ${a}` }
    }
    const fab = entidad === 'fabricacion'
    let cerrada = false
    if (a === 'iniciar') {
      x.estado = fab ? 'fabricando' : 'activo'
      x.inicio ??= t
      const quien = empleadoId ?? operariaLibre()
      if (fab) (x as Fab).operaria ??= quien
      else if (entidad === 'envasado') (x as Env).operaria_1 ??= quien
      else (x as Frac).operaria ??= quien
    } else if (a === 'pausar') {
      x.estado = fab ? 'pausada' : 'pausado'
      x.reanudarEn = t + entre(6, 18) * MIN
    } else if (a === 'reanudar') {
      x.estado = fab ? 'fabricando' : 'activo'
      x.reanudarEn = null
    } else if (a === 'finalizar') {
      if (fab && x.estado === 'para_envasar') {
        x.estado = 'finalizada' // cierre manual con merma
        x.fin = t
        cerrada = true
      } else if (fab) {
        x.estado = 'para_envasar'
      } else {
        cerrada = terminarTarea(entidad, x as Env | Frac)
      }
    } else {
      x.estado = fab ? 'cancelada' : 'cancelado'
      x.fin = t
    }
    evento(entidad, id, a, empleadoId)
    return { ok: true, fabricacion_cerrada: cerrada }
  }

  // ---------- un minuto de planta ----------
  function progreso() {
    for (const f of fabs) {
      if (f.estado !== 'fabricando') continue
      f.efectivos += 1
      if (f.efectivos * LITROS_FAB_POR_MIN >= f.litros) {
        f.estado = 'para_envasar'
        evento('fabricacion', f.id, 'finalizar', f.operaria)
      }
    }
    for (const e of envs) {
      if (e.estado !== 'activo') continue
      e.efectivos += 1
      e.hechas = Math.min(e.cantidad, e.hechas + LITROS_ENV_POR_MIN / presentacion(e.presentacion_id).litros_equiv)
      if (e.hechas >= e.cantidad) {
        terminarTarea('envasado', e)
        evento('envasado', e.id, 'finalizar', e.operaria_1)
      }
    }
    for (const x of fracs) {
      if (x.estado !== 'activo') continue
      x.efectivos += 1
      x.hechas = Math.min(x.cantidad, x.hechas + UNIDADES_FRAC_POR_MIN)
      if (x.hechas >= x.cantidad) {
        terminarTarea('fraccionado', x)
        evento('fraccionado', x.id, 'finalizar', x.operaria)
      }
    }
  }

  function piloto() {
    // retomar pausas vencidas
    for (const [entidad, lista] of [['fabricacion', fabs], ['envasado', envs], ['fraccionado', fracs]] as const) {
      for (const x of lista as Base[]) {
        if (PAUSA.has(x.estado) && x.reanudarEn !== null && x.reanudarEn <= t) accion(entidad, x.id, 'reanudar')
      }
    }
    // arrancar lo que está en cola si hay quien
    // siempre queda al menos una orden esperando en la cola (salvo de vez en cuando)
    const enCola = fabs.filter((f) => f.estado === 'cola')
    for (const f of enCola) {
      if (enCola.filter((x) => x.estado === 'cola').length > 1 || azar() < 0.01) {
        if (azar() < 0.1 && operariaLibre()) accion('fabricacion', f.id, 'iniciar')
      }
    }
    for (const e of envs) if (e.estado === 'cola' && azar() < 0.3 && operariaLibre()) accion('envasado', e.id, 'iniciar')
    for (const x of fracs) if (x.estado === 'cola' && azar() < 0.15 && operariaLibre()) accion('fraccionado', x.id, 'iniciar')
    // alguna pausa de vez en cuando
    for (const f of fabs) if (f.estado === 'fabricando' && azar() < 0.006) accion('fabricacion', f.id, 'pausar')
    for (const e of envs) if (e.estado === 'activo' && azar() < 0.006) accion('envasado', e.id, 'pausar')
    // tanques listos: cargar el envasado de lo que falta
    for (const f of fabs) {
      if (f.estado !== 'para_envasar' || envs.some((e) => e.fabricacion_id === f.id && ABIERTA_TAREA.has(e.estado))) continue
      const falta = f.litros - f.envasado
      if (falta <= 0.5) {
        cerrarSiCorresponde(f)
        continue
      }
      if (azar() > 0.25) continue
      const p = elegir(PRESENTACIONES.filter((x) => x.nombre !== '1kg'))
      const litros = falta > 900 && azar() < 0.5 ? Math.round(falta / 2) : falta
      insertar('envasados', { fabricacion_id: f.id, presentacion_id: p.id, cantidad: Math.max(1, Math.ceil(litros / p.litros_equiv)) })
    }
    // tanques libres: nueva orden
    for (const tq of TANQUES) {
      if (fabAbierta(tq.id) || azar() > 0.1) continue
      const litros = Math.round((tq.capacidad_l * (0.55 + azar() * 0.35)) / 50) * 50
      insertar('fabricaciones', { tanque_id: tq.id, producto_id: elegir(PRODUCTOS).id, litros })
    }
    // fraccionado: siempre una o dos en marcha
    const fraccionando = fracs.filter((x) => ABIERTA_TAREA.has(x.estado)).length
    if (fraccionando === 0 || (fraccionando < 2 && azar() < 0.06)) {
      const p = elegir(PRODUCTOS_FRACCIONADO)
      insertar('fraccionados', { producto_id: p.id, presentacion_id: 'dr6', cantidad: entre(8, 24) * 10 })
    }
  }

  function avanzar(minutos: number) {
    for (let i = 0; i < minutos; i++) {
      progreso()
      if (autonomo) piloto()
      t += MIN
    }
  }

  // ---------- vistas ----------
  const visible = (x: Base, terminado: string) => x.estado !== terminado || (x.fin ?? 0) >= t - VENTANA_TERMINADAS

  function vFlujo(): Fila[] {
    const filas: Fila[] = []
    for (const f of fabs) {
      if (f.estado === 'cancelada' || !visible(f, 'finalizada')) continue
      const p = producto(f.producto_id)
      filas.push({
        entidad: 'fabricacion', id: f.id, estado: f.estado, producto: p?.nombre ?? null, color: p?.color ?? null,
        tanque_codigo: tanque(f.tanque_id).codigo, presentacion: null, cantidad: null, litros: f.litros, lote: f.lote,
        descripcion: null, operaria_1: f.operaria, operaria_2: null, listo: true, inicio: iso(f.inicio),
        min_efectivos: f.inicio === null ? null : f.efectivos, corriendo: f.estado === 'fabricando',
        created_at: iso(f.creado), fin: iso(f.fin), fabricacion_id: null, litros_restantes: restante(f),
      })
    }
    for (const e of envs) {
      if (e.estado === 'cancelado' || !visible(e, 'finalizado')) continue
      const f = fabDe(e.fabricacion_id)
      const p = producto(f.producto_id)
      const pr = presentacion(e.presentacion_id)
      filas.push({
        entidad: 'envasado', id: e.id, estado: e.estado, producto: p?.nombre ?? null, color: p?.color ?? null,
        tanque_codigo: tanque(f.tanque_id).codigo, presentacion: pr.nombre, cantidad: e.cantidad, litros: e.cantidad * pr.litros_equiv,
        lote: f.lote, descripcion: null, operaria_1: e.operaria_1, operaria_2: e.operaria_2, listo: f.estado === 'para_envasar',
        inicio: iso(e.inicio), min_efectivos: e.inicio === null ? null : e.efectivos, corriendo: e.estado === 'activo',
        created_at: iso(e.creado), fin: iso(e.fin), fabricacion_id: f.id, litros_restantes: restante(f),
      })
    }
    for (const x of fracs) {
      if (x.estado === 'cancelado' || !visible(x, 'finalizado')) continue
      const p = producto(x.producto_id)
      const pr = presentacion(x.presentacion_id)
      filas.push({
        entidad: 'fraccionado', id: x.id, estado: x.estado, producto: p?.nombre ?? x.descripcion, color: p?.color ?? null,
        tanque_codigo: null, presentacion: pr.nombre, cantidad: x.cantidad, litros: x.cantidad * pr.litros_equiv, lote: x.lote,
        descripcion: x.descripcion, operaria_1: x.operaria, operaria_2: null, listo: true, inicio: iso(x.inicio),
        min_efectivos: x.inicio === null ? null : x.efectivos, corriendo: x.estado === 'activo', created_at: iso(x.creado),
        fin: iso(x.fin), fabricacion_id: null, litros_restantes: null,
      })
    }
    return filas.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  }

  function vTanques(): Fila[] {
    return TANQUES.map((tq) => {
      const f = fabAbierta(tq.id)
      const vacio = {
        tanque_id: tq.id, codigo: tq.codigo, capacidad_l: tq.capacidad_l, orden: tq.orden, estado: 'libre',
        fabricacion_id: null, producto_id: null, producto: null, color: null, litros: null, litros_restantes: null,
        envasado_id: null, operaria_id: null, inicio: null,
      }
      if (!f) return vacio
      const p = producto(f.producto_id)
      const abiertos = envs.filter((e) => e.fabricacion_id === f.id && ABIERTA_TAREA.has(e.estado))
      const activo = abiertos.find((e) => e.estado === 'activo')
      const pausado = abiertos.find((e) => e.estado === 'pausado')
      const env = activo ?? pausado ?? null
      const estado =
        f.estado !== 'para_envasar' ? f.estado : activo ? 'envasando' : pausado ? 'env_pausado' : abiertos.length ? 'cola_env' : 'para_envasar'
      return {
        ...vacio, estado, fabricacion_id: f.id, producto_id: f.producto_id, producto: p?.nombre ?? null, color: p?.color ?? null,
        litros: f.litros, litros_restantes: restante(f), envasado_id: env?.id ?? null,
        operaria_id: env ? env.operaria_1 : f.operaria, inicio: iso(env?.inicio ?? f.inicio),
      }
    })
  }

  function consultar(tabla: string): Fila[] {
    switch (tabla) {
      case 'v_flujo':
        return vFlujo()
      case 'v_tanque_estado':
        return vTanques()
      case 'v_operarias':
        return OPERARIAS.map((o) => ({ ...o, foto_url: null, activo: true }))
      case 'productos':
        return [...PRODUCTOS, ...PRODUCTOS_FRACCIONADO].map((p) => ({ ...p, litros_hora_std: null, activo: true }))
      case 'presentaciones':
        return PRESENTACIONES.map((p) => ({ ...p, activo: true }))
      case 'tanques':
        return TANQUES.map((x) => ({ ...x, activo: true }))
      case 'v_tiempos_estandar':
        return [
          ...PRODUCTOS.map((p) => ({ entidad: 'fabricacion', clave: p.nombre, velocidad: LITROS_FAB_POR_MIN, muestras: 12, litros_hora_std: null })),
          ...PRESENTACIONES.map((p) => ({ entidad: 'envasado', clave: p.nombre, velocidad: LITROS_ENV_POR_MIN / p.litros_equiv, muestras: 12, litros_hora_std: null })),
        ]
      case 'eventos':
        return eventos.map((e) => ({ ...e }))
      case 'envasados':
        return envs.map((e) => ({
          id: e.id, fabricacion_id: e.fabricacion_id, presentacion_id: e.presentacion_id, cantidad: e.cantidad, estado: e.estado,
          presentaciones: { litros_equiv: presentacion(e.presentacion_id).litros_equiv },
        }))
      default:
        return []
    }
  }

  // Estado inicial: casi todos los tanques con una orden, y la planta "calentada" unas horas.
  if (autonomo) {
    for (const tq of TANQUES) {
      if (azar() < 0.85) {
        const litros = Math.round((tq.capacidad_l * (0.55 + azar() * 0.35)) / 50) * 50
        insertar('fabricaciones', { tanque_id: tq.id, producto_id: elegir(PRODUCTOS).id, litros })
      }
    }
    avanzar(calentar)
  }

  return { ahora: () => t, avanzar, consultar, accion, insertar }
}
