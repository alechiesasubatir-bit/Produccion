// Simulador de planta para la DEMO: una "base de datos" en memoria que avanza sola por minutos
// simulados. Devuelve las mismas vistas que Supabase (v_flujo, v_tanque_estado, …) para que la app
// real las muestre sin cambios. Las transiciones son las del dominio (accionesPosibles).
import { accionesPosibles, type Accion, type Entidad } from '../domain/acciones'
import type { CodigoError } from '../lib/errores'
import {
  LITROS_ENV_POR_MIN,
  LITROS_FAB_POR_MIN,
  CODIGOS_INICIALES,
  ETIQUETAS,
  GRANEL_DOCUMENTO,
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
type Fab = Base & {
  tanque_id: string
  producto_id: string
  litros: number
  lote: string | null
  origen: 'formula' | 'stock' // stock: granel que ya estaba en el tanque sin pasar por la app
  operaria: string | null
  envasado: number
  vencimiento: string | null
  fecha_formula: string | null
  controlEn: number | null // cuándo la encargada demo controla (solo en en_control)
  minExtra: number // minutos extra de fabricación por controles rechazados
}
// Control para liberación, como produccion.controles.
type Control = {
  id: string
  fabricacion_id: string
  intento: number
  ph: number | null
  densidad: number | null
  perfume_ok: boolean
  perfume_comentario: string | null
  visual_ok: boolean
  visual_comentario: string | null
  observaciones: string | null
  resultado: 'aprobado' | 'rechazado'
  firmado_por: string
  firmado_nombre: string
  origen: 'panel' | 'tablet'
  created_at: string
}
// Lo que manda registrar_control (`firmante`: la liberadora elegida en la tablet; sin firmante firma el panel).
export type DatosControl = {
  fabricacionId: string
  ph: number | null
  densidad: number | null
  perfumeOk: boolean | null
  perfumeComentario?: string | null
  visualOk: boolean | null
  visualComentario?: string | null
  observaciones?: string | null
  resultado: string | null
  firmante?: string | null
}
// Materia prima de la fórmula (checklist de la tablet), como produccion.fabricacion_mp.
type Mp = {
  id: string
  fabricacion_id: string
  orden: number
  codigo: string
  descripcion: string
  cantidad: number
  lote: string | null
  pesado: boolean
  cargado_por: string | null
  cargado_at: string | null
}
type Env = Base & {
  fabricacion_id: string | null // null: espera fabricación (envasado cargado desde un PDF sin tanque)
  granel_id: string | null
  presentacion_id: string
  cantidad: number
  hechas: number
  operaria_1: string | null
  operaria_2: string | null
  etiqueta_id: string | null
  lote: string | null // lote del documento
  codigo: string | null
  descripcion: string | null
  litros_granel: number | null
}
type Frac = Base & {
  producto_id: string | null
  descripcion: string | null
  presentacion_id: string | null
  cantidad: number
  hechas: number
  lote: string | null
  codigo: string | null
  operaria: string | null
  etiqueta_id: string | null
}
// Consumible (envase, tapa, etiqueta…) de un envasado o fraccionado, como produccion.consumibles.
type Consumible = {
  id: string
  entidad: 'envasado' | 'fraccionado'
  entidad_id: string
  orden: number
  codigo: string
  descripcion: string
  cantidad: number
  lote: string | null
  cargado_por: string | null
  cargado_at: string | null
}
type Evento = { entidad: Entidad; entidad_id: string; accion: string; at: string; empleado_id: string | null; usuario_id: string | null; datos: Fila }
type Unidad = 'L' | 'kg'
// Tramo de una operaria en una orden, como produccion.participaciones.
type Participacion = {
  id: string
  entidad: Entidad
  entidad_id: string
  empleado_id: string
  desde: string
  hasta: string | null
  cantidad: number | null
  unidad: Unidad | null
  cantidad_corregida: number | null
  corregida_por: string | null
  corregida_at: string | null
}
// Lo que la tablet declara al salir o finalizar (p_cantidades de accion()).
export type CantidadDeclarada = { empleado_id: string; cantidad: number; unidad: string }

// Usuario de la encargada en la demo (quien corrige cantidades; lo devuelve listar_usuarios).
const ENCARGADA = { id: 'du1', email: 'encargada@demo.local', nombre: 'Encargada Demo', rol: 'sin_acceso', rol_produccion: 'panel', activo: true }

export type ResultadoAccion = { ok: true; fabricacion_cerrada: boolean } | { ok: false; codigo: CodigoError; detalle: string }
export type Rechazo = { ok: false; codigo: CodigoError; detalle: string | null }
export type Fila = Record<string, unknown>

export type Simulador = {
  ahora(): number
  avanzar(minutos: number): void
  consultar(tabla: string): Fila[]
  /** Como la RPC accion(). Sin `empleadoId` es la encargada desde el panel (no exige cantidades). */
  accion(entidad: Entidad, id: string, accion: Accion, empleadoId?: string | null, cantidades?: CantidadDeclarada[] | null): ResultadoAccion
  insertar(tabla: string, datos: Fila): void
  /** Como la RPC crear_fabricacion_formula: la fabricación y su checklist de MP, todo o nada. */
  crearFormula(fab: Fila, mp: Fila[]): { ok: true; id: string } | Rechazo
  /** Como la RPC cargar_mp (en la demo no hay PIN real: cualquier operaria puede cargar). */
  cargarMp(mpId: string, lote: string | null, pesado: boolean, empleadoId?: string | null): { ok: true } | Rechazo
  /** Como la RPC corregir_cantidad (solo la encargada). */
  corregirCantidad(participacionId: string, cantidad: number, unidad?: string | null): { ok: true } | Rechazo
  /** Como la RPC set_vencimiento (`fecha` como YYYY-MM-DD). */
  setVencimiento(fabId: string, fecha: string | null, empleadoId?: string | null): { ok: true } | Rechazo
  /** Como la RPC listar_usuarios. */
  usuarios(): Fila[]
  /** Como la RPC registrar_control: aprobado → para_envasar; rechazado → fabricando. */
  registrarControl(d: DatosControl): { ok: true; intento: number } | Rechazo
  /** Como la RPC listar_liberadoras. */
  liberadoras(): { id: string; nombre: string }[]
  /** Como la RPC crear_granel_stock: granel que no se fabricó en la app, el tanque queda para envasar. */
  crearGranelStock(d: { tanque_id: string; producto_id: string; litros: number; lote: string | null }): { ok: true; id: string } | Rechazo
  /** Como la RPC crear_envasado_documento (con o sin tanque) y sus consumibles. */
  crearEnvasadoDocumento(env: Fila, consumibles?: Fila[] | null): { ok: true; id: string } | Rechazo
  /** Como la RPC crear_fraccionado_documento. */
  crearFraccionadoDocumento(frac: Fila, consumibles?: Fila[] | null): { ok: true; id: string } | Rechazo
  /** Como la RPC cargar_consumible (sin empleado carga la encargada desde el panel). */
  cargarConsumible(id: string, lote: string | null, empleadoId?: string | null): { ok: true } | Rechazo
  /** Update directo de un envasado, validado como el trigger envasados_validar_edicion. */
  editarEnvasado(id: string, cambios: Fila): { ok: true } | Rechazo
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

const ABIERTA_FAB = new Set(['cola', 'fabricando', 'pausada', 'en_control', 'para_envasar'])
const TAREA_FAB = new Set(['cola', 'fabricando', 'pausada', 'en_control'])
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
  const mps: Mp[] = []
  const partes: Participacion[] = []
  const controles: Control[] = []
  const consumibles: Consumible[] = []
  const etiquetas = ETIQUETAS.map((e, i) => ({ ...e, activo: true, created_at: new Date(opts.inicio - (10 - i) * 24 * 60 * MIN).toISOString() }))
  const codigos = new Map<string, string>(Object.entries(CODIGOS_INICIALES)) // producto_id → código de la fórmula

  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
  const elegir = <T,>(lista: T[]): T => lista[Math.floor(azar() * lista.length)]
  const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1))
  const nuevoId = (p: string) => `${p}${++sec}`
  const evento = (entidad: Entidad, id: string, accion: string, empleado: string | null = null, datos: Fila = {}, usuario: string | null = null) =>
    eventos.push({ entidad, entidad_id: id, accion, at: new Date(t).toISOString(), empleado_id: empleado, usuario_id: usuario, datos })

  const producto = (id: string | null) => [...PRODUCTOS, ...PRODUCTOS_FRACCIONADO, GRANEL_DOCUMENTO].find((p) => p.id === id)
  const presentacion = (id: string) => PRESENTACIONES.find((p) => p.id === id)!
  // Presentación opcional (un fraccionado del PDF puede venir sin ella).
  const presOpc = (id: string | null) => (id === null ? undefined : PRESENTACIONES.find((p) => p.id === id))
  const equivDe = (id: string | null) => presOpc(id)?.litros_equiv ?? 1
  const tanque = (id: string) => TANQUES.find((x) => x.id === id)!
  const fabDe = (id: string) => fabs.find((f) => f.id === id)!
  const fabDeEnv = (e: Env) => (e.fabricacion_id ? fabDe(e.fabricacion_id) : null)
  // El granel de un envasado: el de su fabricación o, sin tanque, el del documento.
  const granelDe = (e: Env) => fabDeEnv(e)?.producto_id ?? e.granel_id

  const abiertas = (entidad: Entidad, id: string) => partes.filter((p) => p.entidad === entidad && p.entidad_id === id && p.hasta === null)
  const nombreOperaria = (id: string) => OPERARIAS.find((o) => o.empleado_id === id)?.nombre ?? 'Operaria'
  const abrirParte = (entidad: Entidad, id: string, empleado: string | null) => {
    if (!empleado || abiertas(entidad, id).some((p) => p.empleado_id === empleado)) return
    partes.push({
      id: nuevoId('dq'), entidad, entidad_id: id, empleado_id: empleado, desde: new Date(t).toISOString(), hasta: null,
      cantidad: null, unidad: null, cantidad_corregida: null, corregida_por: null, corregida_at: null,
    })
  }
  // Quien está en una orden abierta (en marcha o pausada) no está libre para otra.
  const ocupadas = () => new Set(partes.filter((p) => p.hasta === null).map((p) => p.empleado_id))
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
  const mpDe = (fabId: string) => mps.filter((m) => m.fabricacion_id === fabId)
  const mpCompleta = (m: Mp) => !!m.lote?.trim() && m.pesado
  const mpFaltan = (fabId: string) => mpDe(fabId).filter((m) => !mpCompleta(m)).length

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
        origen: 'formula',
        operaria: (d.operaria_id as string | null) ?? null,
        envasado: 0,
        vencimiento: (d.vencimiento as string | null) ?? null,
        fecha_formula: (d.fecha_formula as string | null) ?? null,
        controlEn: null,
        minExtra: 0,
      }
      fabs.push(f)
      evento('fabricacion', f.id, 'crear')
    } else if (tabla === 'envasados') {
      const e: Env = {
        ...base,
        id: nuevoId('de'),
        fabricacion_id: d.fabricacion_id ? String(d.fabricacion_id) : null,
        granel_id: (d.granel_id as string | null) ?? null,
        presentacion_id: String(d.presentacion_id),
        cantidad: Number(d.cantidad),
        hechas: 0,
        operaria_1: (d.operaria_1 as string | null) ?? null,
        operaria_2: (d.operaria_2 as string | null) ?? null,
        etiqueta_id: (d.etiqueta_id as string | null) ?? null,
        lote: (d.lote as string | null) ?? null,
        codigo: (d.codigo as string | null) ?? null,
        descripcion: (d.descripcion as string | null) ?? null,
        litros_granel: (d.litros_granel as number | null) ?? null,
      }
      envs.push(e)
      evento('envasado', e.id, 'crear')
    } else if (tabla === 'fraccionados') {
      const x: Frac = {
        ...base,
        id: nuevoId('dx'),
        producto_id: (d.producto_id as string | null) ?? null,
        descripcion: (d.descripcion as string | null) ?? null,
        presentacion_id: d.presentacion_id ? String(d.presentacion_id) : null,
        cantidad: Number(d.cantidad),
        hechas: 0,
        lote: (d.lote as string | null) ?? `L-${++numLote}`,
        codigo: (d.codigo as string | null) ?? null,
        operaria: (d.operaria_id as string | null) ?? null,
        etiqueta_id: (d.etiqueta_id as string | null) ?? null,
      }
      fracs.push(x)
      evento('fraccionado', x.id, 'crear')
    } else if (tabla === 'etiquetas') {
      const nombre = String(d.nombre ?? '').trim()
      if (etiquetas.some((e) => e.nombre === nombre)) throw new Error('duplicate key value violates unique constraint "etiquetas_nombre_key"')
      etiquetas.push({ id: nuevoId('det'), nombre, activo: d.activo !== false, created_at: new Date(t).toISOString() })
    } else {
      throw new Error(`La demo no guarda en ${tabla}`)
    }
  }

  function crearFormula(d: Fila, lista: Fila[]): { ok: true; id: string } | Rechazo {
    const lote = String(d.lote ?? '').trim() || null
    if (lote && fabs.some((f) => f.lote === lote && f.estado !== 'cancelada')) {
      return { ok: false, codigo: 'LOTE_DUPLICADO', detalle: lote }
    }
    const tanqueId = String(d.tanque_id ?? '')
    const productoId = String(d.producto_id ?? '')
    const litros = Number(d.litros)
    const filas = lista.map((m, i) => ({
      orden: i + 1,
      codigo: String(m.codigo ?? '').trim(),
      descripcion: String(m.descripcion ?? '').trim(),
      cantidad: Number(m.cantidad),
    }))
    if (
      !TANQUES.some((x) => x.id === tanqueId) ||
      !PRODUCTOS.some((p) => p.id === productoId) ||
      !(litros > 0) ||
      filas.some((m) => !m.codigo || !m.descripcion || !(m.cantidad > 0))
    ) {
      return { ok: false, codigo: 'DATOS_INVALIDOS', detalle: null }
    }
    if (fabAbierta(tanqueId)) return { ok: false, codigo: 'TANQUE_OCUPADO', detalle: null }
    insertar('fabricaciones', { ...d, lote })
    const f = fabs[fabs.length - 1]
    for (const m of filas) {
      mps.push({ ...m, id: nuevoId('dm'), fabricacion_id: f.id, lote: null, pesado: false, cargado_por: null, cargado_at: null })
    }
    // el producto adopta el código de la fórmula si no tiene y nadie más lo usa
    const cod = String(d.codigo_producto ?? '').trim()
    if (cod && !codigos.has(productoId) && ![...codigos.values()].includes(cod)) codigos.set(productoId, cod)
    return { ok: true, id: f.id }
  }

  function cargarMp(mpId: string, lote: string | null, pesado: boolean, empleadoId: string | null = null): { ok: true } | Rechazo {
    const m = mps.find((x) => x.id === mpId)
    if (!m) return { ok: false, codigo: 'NO_ENCONTRADO', detalle: null }
    const f = fabDe(m.fabricacion_id)
    if (f.estado !== 'fabricando' && f.estado !== 'pausada') {
      return { ok: false, codigo: 'TRANSICION_INVALIDA', detalle: `está en estado ${f.estado.replaceAll('_', ' ')}` }
    }
    m.lote = lote?.trim() || null
    m.pesado = !!pesado
    m.cargado_por = empleadoId ?? f.operaria
    m.cargado_at = new Date(t).toISOString()
    return { ok: true }
  }

  // ---------- envasado y fraccionado desde el PDF ----------
  const rech = (codigo: CodigoError, detalle: string | null = null): Rechazo => ({ ok: false, codigo, detalle })
  const vacio = (x: unknown) => (typeof x === 'string' ? x.trim() : '') === ''
  const textoONulo = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)

  // Como produccion._consumibles_validos: [{codigo, descripcion, cantidad}] con cantidad > 0 (vacío o null vale).
  function consumiblesValidos(lista: Fila[] | null | undefined): boolean {
    if (lista === null || lista === undefined) return true
    if (!Array.isArray(lista)) return false
    return lista.every(
      (c) => c !== null && typeof c === 'object' && !Array.isArray(c) && !vacio(c.codigo) && !vacio(c.descripcion) && typeof c.cantidad === 'number' && c.cantidad > 0,
    )
  }
  function guardarConsumibles(entidad: 'envasado' | 'fraccionado', id: string, lista: Fila[] | null | undefined) {
    ;(lista ?? []).forEach((c, i) => {
      consumibles.push({
        id: nuevoId('dk'), entidad, entidad_id: id, orden: i + 1, codigo: String(c.codigo).trim(), descripcion: String(c.descripcion).trim(),
        cantidad: Number(c.cantidad), lote: null, cargado_por: null, cargado_at: null,
      })
    })
  }

  function crearGranelStock(d: { tanque_id: string; producto_id: string; litros: number; lote: string | null }): { ok: true; id: string } | Rechazo {
    const tq = TANQUES.find((x) => x.id === d.tanque_id)
    if (!tq || !producto(d.producto_id) || !(d.litros > 0) || d.litros > tq.capacidad_l) return rech('DATOS_INVALIDOS')
    if (fabAbierta(tq.id)) return rech('TANQUE_OCUPADO')
    const f: Fab = {
      estado: 'para_envasar', creado: t, inicio: t, fin: t, efectivos: 0, reanudarEn: null,
      id: nuevoId('df'), tanque_id: tq.id, producto_id: d.producto_id, litros: Number(d.litros), lote: textoONulo(d.lote), origen: 'stock',
      operaria: null, envasado: 0, vencimiento: null, fecha_formula: null, controlEn: null, minExtra: 0,
    }
    fabs.push(f)
    evento('fabricacion', f.id, 'crear')
    return { ok: true, id: f.id }
  }

  function crearEnvasadoDocumento(d: Fila, lista: Fila[] | null = []): { ok: true; id: string } | Rechazo {
    const fabId = d.fabricacion_id ? String(d.fabricacion_id) : null
    const granel = d.granel_id ? String(d.granel_id) : null
    const pres = d.presentacion_id ? String(d.presentacion_id) : null
    const cantidad = d.cantidad === null || d.cantidad === undefined ? NaN : Number(d.cantidad)
    const litros = d.litros_granel === null || d.litros_granel === undefined ? null : Number(d.litros_granel)
    if (
      !granel || !pres || !producto(granel) || !presOpc(pres) || !Number.isInteger(cantidad) || cantidad <= 0 ||
      (litros !== null && !(litros > 0)) || !consumiblesValidos(lista)
    ) {
      return rech('DATOS_INVALIDOS')
    }
    if (fabId) {
      const f = fabs.find((y) => y.id === fabId)
      if (!f) return rech('NO_ENCONTRADO')
      if (!ABIERTA_FAB.has(f.estado)) return rech('TRANSICION_INVALIDA', `la fabricación está en estado ${f.estado.replaceAll('_', ' ')}`)
      if (f.producto_id !== granel) return rech('GRANEL_DISTINTO')
    }
    insertar('envasados', {
      fabricacion_id: fabId, granel_id: granel, presentacion_id: pres, cantidad, lote: textoONulo(d.lote), codigo: textoONulo(d.codigo),
      descripcion: textoONulo(d.descripcion), litros_granel: litros, etiqueta_id: d.etiqueta_id ? String(d.etiqueta_id) : null,
    })
    const e = envs[envs.length - 1]
    guardarConsumibles('envasado', e.id, lista)
    return { ok: true, id: e.id }
  }

  function crearFraccionadoDocumento(d: Fila, lista: Fila[] | null = []): { ok: true; id: string } | Rechazo {
    const prod = d.producto_id ? String(d.producto_id) : null
    const pres = d.presentacion_id ? String(d.presentacion_id) : null
    const cantidad = d.cantidad === null || d.cantidad === undefined ? NaN : Number(d.cantidad)
    if (!Number.isInteger(cantidad) || cantidad <= 0 || (prod && !producto(prod)) || (pres && !presOpc(pres)) || !consumiblesValidos(lista)) {
      return rech('DATOS_INVALIDOS')
    }
    insertar('fraccionados', {
      producto_id: prod, presentacion_id: pres, cantidad, lote: textoONulo(d.lote) ?? '', codigo: textoONulo(d.codigo),
      descripcion: textoONulo(d.descripcion), etiqueta_id: d.etiqueta_id ? String(d.etiqueta_id) : null,
    })
    const x = fracs[fracs.length - 1]
    if (!textoONulo(d.lote)) x.lote = null // un documento sin lote no inventa uno
    guardarConsumibles('fraccionado', x.id, lista)
    return { ok: true, id: x.id }
  }

  function cargarConsumible(id: string, lote: string | null, empleadoId: string | null = null): { ok: true } | Rechazo {
    if (empleadoId !== null && !OPERARIAS.some((o) => o.empleado_id === empleadoId)) return rech('OPERARIA_INACTIVA')
    const c = consumibles.find((y) => y.id === id)
    if (!c) return rech('NO_ENCONTRADO')
    const tarea = c.entidad === 'envasado' ? envs.find((e) => e.id === c.entidad_id) : fracs.find((x) => x.id === c.entidad_id)
    if (!tarea) return rech('NO_ENCONTRADO')
    if (tarea.estado !== 'activo' && tarea.estado !== 'pausado') return rech('TRANSICION_INVALIDA', `está en estado ${tarea.estado.replaceAll('_', ' ')}`)
    const en = abiertas(c.entidad, c.entidad_id)
    if (empleadoId !== null && en.length > 0 && !en.some((p) => p.empleado_id === empleadoId)) return rech('NO_PARTICIPA')
    c.lote = textoONulo(lote)
    c.cargado_por = empleadoId ?? ('operaria_1' in tarea ? tarea.operaria_1 : tarea.operaria)
    c.cargado_at = new Date(t).toISOString()
    return { ok: true }
  }

  // Como el trigger envasados_validar_edicion: cantidad/presentación no se tocan cerrado; el tanque solo en cola,
  // a una fabricación abierta del mismo granel.
  function editarEnvasado(id: string, cambios: Fila): { ok: true } | Rechazo {
    const e = envs.find((y) => y.id === id)
    if (!e) return { ok: true } // un update que no encuentra filas no falla
    const cantidad = 'cantidad' in cambios ? Number(cambios.cantidad) : e.cantidad
    const pres = 'presentacion_id' in cambios ? String(cambios.presentacion_id) : e.presentacion_id
    const fabId = 'fabricacion_id' in cambios ? ((cambios.fabricacion_id as string | null) ?? null) : e.fabricacion_id
    const granel = 'granel_id' in cambios ? ((cambios.granel_id as string | null) ?? null) : e.granel_id
    if ((cantidad !== e.cantidad || pres !== e.presentacion_id) && (e.estado === 'finalizado' || e.estado === 'cancelado')) return rech('NO_EDITABLE')
    if (fabId !== e.fabricacion_id) {
      if (e.estado !== 'cola') return rech('TANQUE_EN_USO')
      if (fabId === null) return rech('SIN_TANQUE')
      const dest = fabs.find((f) => f.id === fabId)
      if (!dest || !ABIERTA_FAB.has(dest.estado)) return rech('TRANSICION_INVALIDA')
      const viejo = e.fabricacion_id ? fabDe(e.fabricacion_id).producto_id : null
      if (dest.producto_id !== (granel ?? viejo)) return rech('GRANEL_DISTINTO')
    }
    e.cantidad = cantidad
    e.presentacion_id = pres
    e.fabricacion_id = fabId
    e.granel_id = granel
    return { ok: true }
  }

  // ---------- acciones ----------
  function cerrarSiCorresponde(f: Fab): boolean {
    // como accion(): solo si no quedan otros envasados pendientes de la fabricación
    const pendientes = envs.some((e) => e.fabricacion_id === f.id && ABIERTA_TAREA.has(e.estado))
    if (f.estado === 'para_envasar' && !pendientes && f.envasado >= f.litros - 0.5) {
      f.estado = 'finalizada'
      f.fin = t
      cerrarPartes('fabricacion', f.id)
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
    const f = fabDeEnv(e)
    if (!f) return false
    f.envasado += e.cantidad * presentacion(e.presentacion_id).litros_equiv
    return cerrarSiCorresponde(f)
  }

  const cierre = (p: Participacion, cantidad: number | null, unidad: string | null) => {
    p.hasta = new Date(t).toISOString()
    p.cantidad = cantidad
    p.unidad = (unidad as Unidad | null) ?? null
  }
  // Cierra los tramos abiertos de la orden (con lo declarado por cada operaria, si hay).
  function cerrarPartes(entidad: Entidad, id: string, declarado = new Map<string, CantidadDeclarada>(), solo?: string) {
    for (const p of abiertas(entidad, id)) {
      if (solo && p.empleado_id !== solo) continue
      const d = declarado.get(p.empleado_id)
      cierre(p, d ? d.cantidad : null, d ? d.unidad : null)
    }
  }

  // Un fraccionado sin producto (PDF sin coincidencia) es de polvo: va en kg.
  const unidadDe = (productoId: string | null): Unidad => (productoId === null || producto(productoId)?.tipo === 'polvo' ? 'kg' : 'L')
  const productoDe = (entidad: Entidad, x: Base) =>
    entidad === 'fabricacion' ? (x as Fab).producto_id : entidad === 'envasado' ? granelDe(x as Env) : (x as Frac).producto_id
  const cantidadValida = (c: CantidadDeclarada | undefined) =>
    !!c && typeof c.cantidad === 'number' && c.cantidad > 0 && (c.unidad === 'L' || c.unidad === 'kg')
  const rechazo = (codigo: CodigoError, detalle = ''): ResultadoAccion => ({ ok: false, codigo, detalle })

  function accion(entidad: Entidad, id: string, a: Accion, empleadoId: string | null = null, cantidades: CantidadDeclarada[] | null = null): ResultadoAccion {
    const lista: Base[] = entidad === 'fabricacion' ? fabs : entidad === 'envasado' ? envs : fracs
    const planta = empleadoId !== null
    if (!planta && (a === 'sumarse' || a === 'salir')) return rechazo('NO_AUTORIZADO')
    if (planta && !OPERARIAS.some((o) => o.empleado_id === empleadoId)) return rechazo('OPERARIA_INACTIVA')
    const x = lista.find((y) => y.id === id)
    if (!x) return rechazo('NO_ENCONTRADO', id)
    // un envasado que espera fabricación no se inicia ni admite operarias
    if (entidad === 'envasado' && (a === 'iniciar' || a === 'sumarse') && (x as Env).fabricacion_id === null) return rechazo('SIN_TANQUE')
    const fab = entidad === 'fabricacion'
    const enCurso = fab ? x.estado === 'fabricando' || x.estado === 'pausada' : x.estado === 'activo' || x.estado === 'pausado'
    const valida = a === 'sumarse' || a === 'salir' ? enCurso : accionesPosibles(entidad, x.estado, 'panel').includes(a)
    if (!valida) return rechazo('TRANSICION_INVALIDA', `${x.estado} → ${a}`)
    let cerrada = false
    // como accion(): no se finaliza la fabricación con materias primas sin lote o sin pesar
    if (fab && a === 'finalizar' && x.estado === 'fabricando') {
      const faltan = mpFaltan(x.id)
      if (faltan > 0) return rechazo('MP_INCOMPLETA', String(faltan))
    }

    // participaciones
    const en = abiertas(entidad, id)
    const participa = en.some((p) => p.empleado_id === empleadoId)
    if (a === 'sumarse' && participa) return rechazo('YA_PARTICIPA')
    if (a === 'salir') {
      if (!participa) return rechazo('NO_PARTICIPA')
      if (en.length === 1) return rechazo('ULTIMA_OPERARIA')
    }
    // desde la tablet solo pausa/reanuda/finaliza quien está en la orden; si no hay nadie, entra quien acciona
    const trabaja = a === 'pausar' || a === 'reanudar' || a === 'finalizar'
    if (planta && trabaja && en.length > 0 && !participa) return rechazo('NO_PARTICIPA')
    const abreQuienAcciona = planta && trabaja && en.length === 0

    // una operaria en un solo envasado activo a la vez (los pausados no bloquean)
    if (entidad === 'envasado' && a === 'iniciar' && fabDeEnv(x as Env)?.estado !== 'para_envasar') return rechazo('TANQUE_NO_LISTO')
    if (entidad === 'envasado' && (a === 'iniciar' || a === 'sumarse' || a === 'reanudar')) {
      const e = x as Env
      const quienes = new Set<string>()
      if (a !== 'reanudar') {
        const q = empleadoId ?? e.operaria_1
        if (q) quienes.add(q)
      } else {
        for (const p of en) quienes.add(p.empleado_id)
        if (empleadoId) quienes.add(empleadoId)
        if (en.length === 0 && e.operaria_1) quienes.add(e.operaria_1)
      }
      for (const q of quienes) {
        const otro = envs.find((o) => o.id !== id && o.estado === 'activo' && abiertas('envasado', o.id).some((p) => p.empleado_id === q))
        if (otro) {
          const nombre = `${producto(granelDe(otro))?.nombre ?? ''} ${presentacion(otro.presentacion_id).nombre}`
          return rechazo('OPERARIA_OCUPADA', nombre.trim())
        }
      }
    }

    // cantidades declaradas: envasado/fraccionado al salir o finalizar (obligatorias solo desde la tablet)
    const declarado = new Map<string, CantidadDeclarada>()
    if (a === 'salir' || a === 'finalizar' || a === 'cancelar') {
      if (cantidades !== null && !Array.isArray(cantidades)) return rechazo('CANTIDAD_REQUERIDA')
      if (!fab && a !== 'cancelar') {
        for (const p of en) {
          if (a === 'salir' && p.empleado_id !== empleadoId) continue
          const c = (cantidades ?? []).find((y) => y.empleado_id === p.empleado_id)
          if (!c) {
            if (planta) return rechazo('CANTIDAD_REQUERIDA')
          } else if (!cantidadValida(c)) {
            return rechazo('CANTIDAD_REQUERIDA')
          } else {
            declarado.set(p.empleado_id, c)
          }
        }
      }
    }

    if (abreQuienAcciona) abrirParte(entidad, id, empleadoId)
    let quienInicia: string | null = null
    if (a === 'sumarse' || a === 'salir') {
      // no cambian el estado
    } else if (a === 'iniciar') {
      x.estado = fab ? 'fabricando' : 'activo'
      x.inicio ??= t
      const antes = fab ? (x as Fab).operaria : entidad === 'envasado' ? (x as Env).operaria_1 : (x as Frac).operaria
      const quien = empleadoId ?? operariaLibre()
      if (fab) (x as Fab).operaria ??= quien
      else if (entidad === 'envasado') (x as Env).operaria_1 ??= quien
      else (x as Frac).operaria ??= quien
      quienInicia = empleadoId ?? antes ?? quien
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
        x.estado = 'en_control'
      } else {
        // las participaciones se cierran antes: terminarTarea puede cerrar también la fabricación
        cerrarPartes(entidad, id, declarado)
        cerrada = terminarTarea(entidad, x as Env | Frac)
      }
    } else {
      x.estado = fab ? 'cancelada' : 'cancelado'
      x.fin = t
    }

    if (a === 'iniciar') abrirParte(entidad, id, quienInicia)
    else if (a === 'sumarse') abrirParte(entidad, id, empleadoId)
    else if (a === 'salir') cerrarPartes(entidad, id, declarado, empleadoId ?? undefined)
    else if (a === 'finalizar' || a === 'cancelar') cerrarPartes(entidad, id, declarado)

    const propia = declarado.get(empleadoId as string)
    const datos: Fila =
      a === 'salir' && propia
        ? { cantidad: propia.cantidad, unidad: propia.unidad }
        : a === 'finalizar' && declarado.size
          ? { cantidades: [...declarado.values()].map((c) => ({ empleado_id: c.empleado_id, cantidad: c.cantidad, unidad: c.unidad })) }
          : {}
    evento(entidad, id, a, empleadoId, datos)
    return { ok: true, fabricacion_cerrada: cerrada }
  }

  function corregirCantidad(participacionId: string, cantidad: number, unidad: string | null = null): { ok: true } | Rechazo {
    if (!(cantidad > 0) || (unidad !== null && unidad !== 'L' && unidad !== 'kg')) return { ok: false, codigo: 'CANTIDAD_REQUERIDA', detalle: null }
    const p = partes.find((y) => y.id === participacionId)
    if (!p) return { ok: false, codigo: 'NO_ENCONTRADO', detalle: null }
    if (p.hasta === null) return { ok: false, codigo: 'TRANSICION_INVALIDA', detalle: 'la participación sigue abierta' }
    const lista: Base[] = p.entidad === 'fabricacion' ? fabs : p.entidad === 'envasado' ? envs : fracs
    const orden = lista.find((y) => y.id === p.entidad_id)
    const uni = (unidad as Unidad | null) ?? p.unidad ?? (orden ? unidadDe(productoDe(p.entidad, orden)) : 'L')
    evento(p.entidad, p.entidad_id, 'corregir', null, {
      participacion_id: p.id, empleado_id: p.empleado_id, antes: p.cantidad_corregida ?? p.cantidad, despues: cantidad, unidad: uni,
    }, ENCARGADA.id)
    p.cantidad_corregida = cantidad
    p.unidad = uni
    p.corregida_por = ENCARGADA.id
    p.corregida_at = new Date(t).toISOString()
    return { ok: true }
  }

  function setVencimiento(fabId: string, fecha: string | null, empleadoId: string | null = null): { ok: true } | Rechazo {
    if (!fecha) return { ok: false, codigo: 'DATOS_INVALIDOS', detalle: null }
    if (empleadoId !== null && !OPERARIAS.some((o) => o.empleado_id === empleadoId)) return { ok: false, codigo: 'OPERARIA_INACTIVA', detalle: null }
    const f = fabs.find((y) => y.id === fabId)
    if (!f) return { ok: false, codigo: 'NO_ENCONTRADO', detalle: null }
    if (f.estado === 'finalizada' || f.estado === 'cancelada') return { ok: false, codigo: 'TRANSICION_INVALIDA', detalle: `está en estado ${f.estado}` }
    const en = abiertas('fabricacion', fabId)
    if (empleadoId !== null && en.length > 0 && !en.some((p) => p.empleado_id === empleadoId)) return { ok: false, codigo: 'NO_PARTICIPA', detalle: null }
    evento('fabricacion', fabId, 'editar', empleadoId, { vencimiento: { antes: f.vencimiento, despues: fecha } })
    f.vencimiento = fecha
    return { ok: true }
  }

  const MOTIVOS_PERFUME = ['olor débil, falta esencia', 'olor distinto al patrón']
  const MOTIVOS_VISUAL = ['aspecto turbio', 'color más claro que el patrón', 'se ven partículas']

  function registrarControl(d: DatosControl): { ok: true; intento: number } | Rechazo {
    const no = (codigo: CodigoError, detalle: string | null = null): Rechazo => ({ ok: false, codigo, detalle })
    // sin firmante firma la encargada desde el panel; la tablet manda la liberadora elegida
    if (d.firmante && d.firmante !== ENCARGADA.id) return no('NO_AUTORIZADO')
    const origen = d.firmante ? 'tablet' : 'panel'
    const f = fabs.find((y) => y.id === d.fabricacionId)
    if (!f) return no('NO_ENCONTRADO')
    if (f.estado !== 'en_control') return no('TRANSICION_INVALIDA', `está en estado ${f.estado.replaceAll('_', ' ')}`)
    const polvo = producto(f.producto_id)?.tipo === 'polvo'
    const ph = polvo ? null : d.ph
    const densidad = polvo ? null : d.densidad
    const limpio = (x: string | null | undefined) => x?.trim() || null
    const perfume = limpio(d.perfumeComentario)
    const visual = limpio(d.visualComentario)
    const obs = limpio(d.observaciones)
    if (
      (d.resultado !== 'aprobado' && d.resultado !== 'rechazado') ||
      typeof d.perfumeOk !== 'boolean' ||
      typeof d.visualOk !== 'boolean' ||
      (!d.perfumeOk && !perfume) ||
      (!d.visualOk && !visual) ||
      (d.resultado === 'rechazado' && d.perfumeOk && d.visualOk && !obs) || // rechazar exige un motivo
      (!polvo && (typeof ph !== 'number' || !(ph >= 0 && ph <= 14) || typeof densidad !== 'number' || !(densidad > 0)))
    ) {
      return no('DATOS_INVALIDOS')
    }
    const intento = Math.max(0, ...controles.filter((c) => c.fabricacion_id === f.id).map((c) => c.intento)) + 1
    const c: Control = {
      id: nuevoId('dc'), fabricacion_id: f.id, intento, ph: ph ?? null, densidad: densidad ?? null,
      perfume_ok: d.perfumeOk, perfume_comentario: d.perfumeOk ? null : perfume,
      visual_ok: d.visualOk, visual_comentario: d.visualOk ? null : visual, observaciones: obs,
      resultado: d.resultado, firmado_por: ENCARGADA.id, firmado_nombre: ENCARGADA.nombre, origen, created_at: new Date(t).toISOString(),
    }
    controles.push(c)
    f.controlEn = null
    if (d.resultado === 'aprobado') {
      f.estado = 'para_envasar'
    } else {
      f.estado = 'fabricando'
      f.fin = null
      f.minExtra += 5 + (intento % 3) * 5 // retrabajo: unos minutos más de fabricación
    }
    const motivo = [!d.perfumeOk && `perfume No OK (${perfume})`, !d.visualOk && `visual No OK (${visual})`, obs].filter(Boolean).join('; ')
    evento('fabricacion', f.id, d.resultado === 'aprobado' ? 'aprobar' : 'rechazar', null, { control_id: c.id, intento, motivo }, ENCARGADA.id)
    return { ok: true, intento }
  }

  // La encargada demo controla las fabricaciones que llevan un rato en control: aprueba ~85 %.
  function encargadaControla() {
    for (const f of fabs) {
      if (f.estado !== 'en_control') continue
      f.controlEn ??= t + entre(15, 45) * MIN
      if (f.controlEn > t) continue
      const polvo = producto(f.producto_id)?.tipo === 'polvo'
      const rechaza = azar() >= 0.85
      const malo = rechaza ? entre(0, 2) : -1 // 0 perfume, 1 visual, 2 los dos
      registrarControl({
        fabricacionId: f.id,
        ph: polvo ? null : entre(65, 85) / 10,
        densidad: polvo ? null : entre(100, 110) / 100,
        perfumeOk: malo !== 0 && malo !== 2,
        perfumeComentario: malo === 0 || malo === 2 ? elegir(MOTIVOS_PERFUME) : null,
        visualOk: malo !== 1 && malo !== 2,
        visualComentario: malo === 1 || malo === 2 ? elegir(MOTIVOS_VISUAL) : null,
        observaciones: rechaza ? 'Se vuelve a ajustar y se controla de nuevo' : null,
        resultado: rechaza ? 'rechazado' : 'aprobado',
      })
    }
  }

  // ---------- un minuto de planta ----------
  // Al terminar sola, lo que falta declarar se reparte entre quienes siguen en la orden.
  function repartirRestante(entidad: Entidad, x: Env | Frac): Map<string, CantidadDeclarada> {
    const en = abiertas(entidad, x.id)
    const yaDeclarado = partes
      .filter((p) => p.entidad === entidad && p.entidad_id === x.id && p.hasta !== null)
      .reduce((suma, p) => suma + (p.cantidad_corregida ?? p.cantidad ?? 0), 0)
    const resto = Math.max(en.length, Math.round(x.cantidad * equivDe(x.presentacion_id) - yaDeclarado))
    const unidad = unidadDe(productoDe(entidad, x))
    const porCabeza = Math.max(1, Math.floor(resto / Math.max(1, en.length)))
    return new Map(
      en.map((p, i) => [p.empleado_id, { empleado_id: p.empleado_id, cantidad: i === en.length - 1 ? Math.max(1, resto - porCabeza * i) : porCabeza, unidad }]),
    )
  }

  // Alguna operaria libre se suma a una orden en marcha; y quien no es la última sale declarando lo que hizo.
  function equipo() {
    for (const [entidad, lista] of [['fabricacion', fabs], ['envasado', envs], ['fraccionado', fracs]] as const) {
      for (const x of lista as Base[]) {
        if (!CORRIENDO.has(x.estado)) continue
        const en = abiertas(entidad, x.id)
        if (en.length >= 1 && en.length < 3 && azar() < 0.012) {
          const libre = operariaLibre()
          if (libre) accion(entidad, x.id, 'sumarse', libre)
        } else if (en.length >= 2 && azar() < 0.02) {
          const sale = en[en.length - 1].empleado_id
          if (entidad === 'fabricacion') {
            accion(entidad, x.id, 'salir', sale)
          } else {
            const o = x as Env | Frac
            const hecho = o.hechas * equivDe(o.presentacion_id)
            const cantidad = Math.max(1, Math.round(hecho * (0.2 + azar() * 0.3)))
            accion(entidad, x.id, 'salir', sale, [{ empleado_id: sale, cantidad, unidad: unidadDe(productoDe(entidad, x)) }])
          }
        }
      }
    }
  }

  function progreso() {
    for (const f of fabs) {
      if (f.estado !== 'fabricando') continue
      f.efectivos += 1
      // con fórmula, no se da por terminada hasta completar el checklist de MP
      if ((f.efectivos - f.minExtra) * LITROS_FAB_POR_MIN >= f.litros && mpFaltan(f.id) === 0) {
        f.estado = 'en_control'
        cerrarPartes('fabricacion', f.id)
        evento('fabricacion', f.id, 'finalizar', f.operaria)
      }
    }
    for (const e of envs) {
      if (e.estado !== 'activo') continue
      e.efectivos += 1
      e.hechas = Math.min(e.cantidad, e.hechas + LITROS_ENV_POR_MIN / presentacion(e.presentacion_id).litros_equiv)
      if (e.hechas >= e.cantidad) {
        cerrarPartes('envasado', e.id, repartirRestante('envasado', e))
        terminarTarea('envasado', e)
        evento('envasado', e.id, 'finalizar', e.operaria_1)
      }
    }
    for (const x of fracs) {
      if (x.estado !== 'activo') continue
      x.efectivos += 1
      x.hechas = Math.min(x.cantidad, x.hechas + UNIDADES_FRAC_POR_MIN)
      if (x.hechas >= x.cantidad) {
        cerrarPartes('fraccionado', x.id, repartirRestante('fraccionado', x))
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
    for (const e of envs) if (e.estado === 'cola' && e.fabricacion_id && azar() < 0.3 && operariaLibre()) accion('envasado', e.id, 'iniciar')
    for (const x of fracs) if (x.estado === 'cola' && azar() < 0.15 && operariaLibre()) accion('fraccionado', x.id, 'iniciar')
    // la operaria va completando el checklist de MP (lote + pesado), de a una
    // (sin MP pendientes no se consume azar: las fabricaciones a mano siguen igual que antes)
    for (const f of fabs) {
      if (f.estado !== 'fabricando') continue
      const m = mpDe(f.id).find((x) => !mpCompleta(x))
      if (m && azar() < 0.3) cargarMp(m.id, `${m.codigo}-${entre(1000, 9999)}`, true)
    }
    equipo()
    encargadaControla()
    // alguna pausa de vez en cuando
    for (const f of fabs) if (f.estado === 'fabricando' && azar() < 0.006) accion('fabricacion', f.id, 'pausar')
    for (const e of envs) if (e.estado === 'activo' && azar() < 0.006) accion('envasado', e.id, 'pausar')
    // tanques listos: cargar el envasado de lo que falta
    for (const f of fabs) {
      // el granel de stock se envasa solo desde un PDF o a mano: el piloto no lo toca
      if (f.estado !== 'para_envasar' || f.origen === 'stock' || envs.some((e) => e.fabricacion_id === f.id && ABIERTA_TAREA.has(e.estado))) continue
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

  // jsonb `operarias` de las vistas: quienes están trabajando ahora en la orden.
  const operariasDe = (entidad: Entidad, id: string) =>
    abiertas(entidad, id).map((p) => ({ empleado_id: p.empleado_id, nombre: nombreOperaria(p.empleado_id), desde: p.desde }))
  const nombreEtiqueta = (id: string | null) => etiquetas.find((e) => e.id === id)?.nombre ?? null
  const controlesDe = (fabId: string) => controles.filter((c) => c.fabricacion_id === fabId)
  // control_intento: el que viene (controles hechos + 1); control_rechazo: motivo del último rechazo mientras se retrabaja.
  const estadoControl = (f: Fab) => {
    const hechos = controlesDe(f.id)
    const ultimo = hechos[hechos.length - 1]
    const rechazar = [...eventos].reverse().find((e) => e.entidad === 'fabricacion' && e.entidad_id === f.id && e.accion === 'rechazar')
    const motivo =
      (f.estado === 'fabricando' || f.estado === 'pausada') && ultimo?.resultado === 'rechazado'
        ? ((rechazar?.datos.motivo as string | undefined) ?? null)
        : null
    return { control_intento: hechos.length + 1, control_rechazo: motivo }
  }

  const consumiblesDe = (entidad: 'envasado' | 'fraccionado', id: string) =>
    consumibles.filter((c) => c.entidad === entidad && c.entidad_id === id)

  function vFlujo(): Fila[] {
    const filas: Fila[] = []
    for (const f of fabs) {
      if (f.estado === 'cancelada' || !visible(f, 'finalizada')) continue
      const p = producto(f.producto_id)
      filas.push({
        entidad: 'fabricacion', id: f.id, estado: f.estado, producto: p?.nombre ?? null, color: p?.color ?? null, producto_tipo: p?.tipo ?? null,
        tanque_codigo: tanque(f.tanque_id).codigo, presentacion: null, cantidad: null, litros: f.litros, lote: f.lote,
        descripcion: null, operaria_1: f.operaria, operaria_2: null, listo: true, inicio: iso(f.inicio),
        min_efectivos: f.inicio === null ? null : f.efectivos, corriendo: f.estado === 'fabricando',
        created_at: iso(f.creado), fin: iso(f.fin), fabricacion_id: null, litros_restantes: restante(f),
        operarias: operariasDe('fabricacion', f.id), etiqueta: null, ...estadoControl(f), lote_doc: null, granel_id: null, origen: f.origen,
      })
    }
    for (const e of envs) {
      if (e.estado === 'cancelado' || !visible(e, 'finalizado')) continue
      // sin tanque (esperando fabricación): el producto y los litros salen del documento
      const f = fabDeEnv(e)
      const p = producto(granelDe(e))
      const pr = presentacion(e.presentacion_id)
      filas.push({
        entidad: 'envasado', id: e.id, estado: e.estado, producto: p?.nombre ?? null, color: p?.color ?? null, producto_tipo: p?.tipo ?? null,
        tanque_codigo: f ? tanque(f.tanque_id).codigo : null, presentacion: pr.nombre, cantidad: e.cantidad,
        litros: f ? e.cantidad * pr.litros_equiv : e.litros_granel,
        lote: f?.lote ?? null, descripcion: e.descripcion, operaria_1: e.operaria_1, operaria_2: e.operaria_2, listo: f?.estado === 'para_envasar',
        inicio: iso(e.inicio), min_efectivos: e.inicio === null ? null : e.efectivos, corriendo: e.estado === 'activo',
        created_at: iso(e.creado), fin: iso(e.fin), fabricacion_id: f?.id ?? null, litros_restantes: f ? restante(f) : null,
        operarias: operariasDe('envasado', e.id), etiqueta: nombreEtiqueta(e.etiqueta_id),
        control_intento: null, control_rechazo: null, lote_doc: e.lote, granel_id: granelDe(e), origen: null,
      })
    }
    for (const x of fracs) {
      if (x.estado === 'cancelado' || !visible(x, 'finalizado')) continue
      const p = producto(x.producto_id)
      const pr = presOpc(x.presentacion_id)
      filas.push({
        entidad: 'fraccionado', id: x.id, estado: x.estado, producto: p?.nombre ?? x.descripcion, color: p?.color ?? null, producto_tipo: p?.tipo ?? null,
        tanque_codigo: null, presentacion: pr?.nombre ?? null, cantidad: x.cantidad, litros: pr ? x.cantidad * pr.litros_equiv : null, lote: x.lote,
        descripcion: x.descripcion, operaria_1: x.operaria, operaria_2: null, listo: true, inicio: iso(x.inicio),
        min_efectivos: x.inicio === null ? null : x.efectivos, corriendo: x.estado === 'activo', created_at: iso(x.creado),
        fin: iso(x.fin), fabricacion_id: null, litros_restantes: null,
        operarias: operariasDe('fraccionado', x.id), etiqueta: nombreEtiqueta(x.etiqueta_id),
        control_intento: null, control_rechazo: null, lote_doc: x.lote, granel_id: null, origen: null,
      })
    }
    return filas.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  }

  function vTanques(): Fila[] {
    return TANQUES.map((tq) => {
      const f = fabAbierta(tq.id)
      const vacio = {
        tanque_id: tq.id, codigo: tq.codigo, capacidad_l: tq.capacidad_l, orden: tq.orden, estado: 'libre',
        fabricacion_id: null, producto_id: null, producto: null, color: null, litros: null, litros_restantes: null, producto_tipo: null,
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
        ...vacio, estado, fabricacion_id: f.id, producto_id: f.producto_id, producto: p?.nombre ?? null, color: p?.color ?? null, producto_tipo: p?.tipo ?? null,
        litros: f.litros, litros_restantes: restante(f), envasado_id: env?.id ?? null,
        operaria_id: env ? env.operaria_1 : f.operaria, inicio: iso(env?.inicio ?? f.inicio),
      }
    })
  }

  function vTareas(): Fila[] {
    const filas: Fila[] = []
    for (const f of fabs) {
      if (!TAREA_FAB.has(f.estado)) continue
      const p = producto(f.producto_id)
      const mp = mpDe(f.id)
      filas.push({
        entidad: 'fabricacion', id: f.id, estado: f.estado, producto: p?.nombre ?? null, color: p?.color ?? null, producto_tipo: p?.tipo ?? null,
        tanque_codigo: tanque(f.tanque_id).codigo, presentacion: null, cantidad: null, litros: f.litros, lote: f.lote,
        descripcion: null, operaria_1: f.operaria, operaria_2: null, listo: true, inicio: iso(f.inicio),
        min_efectivos: f.inicio === null ? null : f.efectivos, corriendo: f.estado === 'fabricando', created_at: iso(f.creado),
        mp_total: mp.length, mp_completas: mp.filter(mpCompleta).length,
        operarias: operariasDe('fabricacion', f.id), etiqueta: null, vencimiento: f.vencimiento, ...estadoControl(f),
        lote_doc: null, consumibles_total: 0, consumibles_con_lote: 0,
      })
    }
    for (const e of envs) {
      // sin tanque no es tarea de planta
      const f = fabDeEnv(e)
      if (!ABIERTA_TAREA.has(e.estado) || !f) continue
      const p = producto(f.producto_id)
      const cons = consumiblesDe('envasado', e.id)
      filas.push({
        entidad: 'envasado', id: e.id, estado: e.estado, producto: p?.nombre ?? null, color: p?.color ?? null, producto_tipo: p?.tipo ?? null,
        tanque_codigo: tanque(f.tanque_id).codigo, presentacion: presentacion(e.presentacion_id).nombre, cantidad: e.cantidad,
        litros: f.litros, lote: f.lote, descripcion: e.descripcion, operaria_1: e.operaria_1, operaria_2: e.operaria_2,
        listo: f.estado === 'para_envasar', inicio: iso(e.inicio), min_efectivos: e.inicio === null ? null : e.efectivos,
        corriendo: e.estado === 'activo', created_at: iso(e.creado), mp_total: 0, mp_completas: 0,
        operarias: operariasDe('envasado', e.id), etiqueta: nombreEtiqueta(e.etiqueta_id), vencimiento: f.vencimiento,
        control_intento: null, control_rechazo: null,
        lote_doc: e.lote, consumibles_total: cons.length, consumibles_con_lote: cons.filter((c) => c.lote !== null).length,
      })
    }
    for (const x of fracs) {
      if (!ABIERTA_TAREA.has(x.estado)) continue
      const p = producto(x.producto_id)
      const cons = consumiblesDe('fraccionado', x.id)
      filas.push({
        entidad: 'fraccionado', id: x.id, estado: x.estado, producto: p?.nombre ?? null, color: p?.color ?? null, producto_tipo: p?.tipo ?? null,
        tanque_codigo: null, presentacion: presOpc(x.presentacion_id)?.nombre ?? null, cantidad: x.cantidad, litros: null,
        lote: x.lote, descripcion: x.descripcion, operaria_1: x.operaria, operaria_2: null, listo: true, inicio: iso(x.inicio),
        min_efectivos: x.inicio === null ? null : x.efectivos, corriendo: x.estado === 'activo', created_at: iso(x.creado),
        mp_total: 0, mp_completas: 0,
        operarias: operariasDe('fraccionado', x.id), etiqueta: nombreEtiqueta(x.etiqueta_id), vencimiento: null,
        control_intento: null, control_rechazo: null,
        lote_doc: x.lote, consumibles_total: cons.length, consumibles_con_lote: cons.filter((c) => c.lote !== null).length,
      })
    }
    return filas
  }

  // Minutos de un tramo sin las pausas de la orden (pausar → reanudar/finalizar/cancelar), como _minutos_participacion.
  function minutosParte(p: Participacion): number {
    const desde = Date.parse(p.desde)
    const hasta = p.hasta === null ? t : Date.parse(p.hasta)
    const evs = eventos.filter((e) => e.entidad === p.entidad && e.entidad_id === p.entidad_id)
    let pausas = 0
    for (const e of evs) {
      if (e.accion !== 'pausar') continue
      const ini = Date.parse(e.at)
      const cierra = evs.find((y) => ['reanudar', 'finalizar', 'cancelar'].includes(y.accion) && Date.parse(y.at) > ini)
      const fin = cierra ? Date.parse(cierra.at) : t
      pausas += Math.max(0, Math.min(hasta, fin) - Math.max(desde, ini))
    }
    return Math.round((Math.max(0, hasta - desde - pausas) / MIN) * 10) / 10
  }
  const participacionesDe = (entidad: Entidad, id: string) =>
    partes
      .filter((p) => p.entidad === entidad && p.entidad_id === id)
      .map((p) => ({
        empleado_id: p.empleado_id, nombre: nombreOperaria(p.empleado_id), desde: p.desde, hasta: p.hasta,
        cantidad: p.cantidad, unidad: p.unidad, cantidad_corregida: p.cantidad_corregida, minutos: minutosParte(p),
      }))

  // jsonb `consumibles` de v_historial: con quién cargó el lote y cuándo.
  const consumiblesHistorial = (entidad: 'envasado' | 'fraccionado', id: string) =>
    consumiblesDe(entidad, id).map((c) => ({
      codigo: c.codigo, descripcion: c.descripcion, cantidad: c.cantidad, lote: c.lote,
      cargado_nombre: c.cargado_por ? nombreOperaria(c.cargado_por) : null, cargado_at: c.cargado_at,
    }))

  function vHistorial(): Fila[] {
    const dia = (ms: number) => new Date(ms - 3 * 60 * MIN).toISOString().slice(0, 10) // Montevideo, UTC-3
    const tiempos = (x: Base) => {
      const brutos = x.inicio === null ? null : Math.round(((x.fin ?? t) - x.inicio) / MIN)
      return {
        min_brutos: brutos, min_pausa: brutos === null ? null : Math.max(0, brutos - x.efectivos),
        min_efectivos: x.inicio === null ? null : x.efectivos,
      }
    }
    const filas: Fila[] = []
    for (const f of fabs) {
      const p = producto(f.producto_id)
      filas.push({
        entidad: 'fabricacion', id: f.id, estado: f.estado, producto: p?.nombre ?? null, color: p?.color ?? null, tanque_codigo: tanque(f.tanque_id).codigo,
        presentacion: null, cantidad: null, litros: f.litros, litros_equiv: null, lote: f.lote, descripcion: null,
        operaria_1: f.operaria, operaria_1_nombre: f.operaria ? nombreOperaria(f.operaria) : null, operaria_2: null, operaria_2_nombre: null,
        inicio: iso(f.inicio), fin: iso(f.fin), created_at: iso(f.creado), ...tiempos(f), dia: dia(f.fin ?? f.inicio ?? f.creado),
        participaciones: participacionesDe('fabricacion', f.id), etiqueta: null,
        controles: controlesDe(f.id).map(({ id: _id, fabricacion_id: _f, firmado_por: _p, ...c }) => c),
        lote_doc: null, consumibles: [], origen: f.origen,
      })
    }
    for (const e of envs) {
      const f = fabDeEnv(e)
      const p = producto(granelDe(e))
      const pr = presentacion(e.presentacion_id)
      filas.push({
        entidad: 'envasado', id: e.id, estado: e.estado, producto: p?.nombre ?? null, color: p?.color ?? null, tanque_codigo: f ? tanque(f.tanque_id).codigo : null,
        presentacion: pr.nombre, cantidad: e.cantidad, litros: e.cantidad * pr.litros_equiv, litros_equiv: pr.litros_equiv, lote: f?.lote ?? null, descripcion: e.descripcion,
        operaria_1: e.operaria_1, operaria_1_nombre: e.operaria_1 ? nombreOperaria(e.operaria_1) : null,
        operaria_2: e.operaria_2, operaria_2_nombre: e.operaria_2 ? nombreOperaria(e.operaria_2) : null,
        inicio: iso(e.inicio), fin: iso(e.fin), created_at: iso(e.creado), ...tiempos(e), dia: dia(e.fin ?? e.inicio ?? e.creado),
        participaciones: participacionesDe('envasado', e.id), etiqueta: nombreEtiqueta(e.etiqueta_id), controles: [],
        lote_doc: e.lote, consumibles: consumiblesHistorial('envasado', e.id), origen: null,
      })
    }
    for (const x of fracs) {
      const p = producto(x.producto_id)
      const pr = presOpc(x.presentacion_id)
      filas.push({
        entidad: 'fraccionado', id: x.id, estado: x.estado, producto: p?.nombre ?? x.descripcion, color: p?.color ?? null, tanque_codigo: null,
        presentacion: pr?.nombre ?? null, cantidad: x.cantidad, litros: pr ? x.cantidad * pr.litros_equiv : null, litros_equiv: pr?.litros_equiv ?? null, lote: x.lote, descripcion: x.descripcion,
        operaria_1: x.operaria, operaria_1_nombre: x.operaria ? nombreOperaria(x.operaria) : null, operaria_2: null, operaria_2_nombre: null,
        inicio: iso(x.inicio), fin: iso(x.fin), created_at: iso(x.creado), ...tiempos(x), dia: dia(x.fin ?? x.inicio ?? x.creado),
        participaciones: participacionesDe('fraccionado', x.id), etiqueta: nombreEtiqueta(x.etiqueta_id), controles: [],
        lote_doc: x.lote, consumibles: consumiblesHistorial('fraccionado', x.id), origen: null,
      })
    }
    return filas
  }

  function consultar(tabla: string): Fila[] {
    switch (tabla) {
      case 'v_flujo':
        return vFlujo()
      case 'v_tanque_estado':
        return vTanques()
      case 'v_tareas':
        return vTareas()
      case 'v_historial':
        return vHistorial()
      case 'etiquetas':
        return etiquetas.map((e) => ({ ...e }))
      case 'participaciones':
        return partes.map((p) => ({ ...p }))
      case 'controles':
        return controles.map((c) => ({ ...c }))
      case 'consumibles':
        return consumibles.map((c) => ({ ...c }))
      case 'fraccionados':
        return fracs.map((x) => ({
          id: x.id, lote: x.lote, codigo: x.codigo, estado: x.estado, producto_id: x.producto_id, presentacion_id: x.presentacion_id,
          cantidad: x.cantidad, etiqueta_id: x.etiqueta_id,
        }))
      case 'fabricacion_mp':
        return mps.map((m) => ({ ...m }))
      case 'fabricaciones':
        return fabs.map((f) => ({
          id: f.id, tanque_id: f.tanque_id, producto_id: f.producto_id, litros: f.litros, lote: f.lote, estado: f.estado,
          operaria_id: f.operaria, vencimiento: f.vencimiento, fecha_formula: f.fecha_formula, created_at: iso(f.creado), origen: f.origen,
        }))
      case 'v_operarias':
        return OPERARIAS.map((o) => ({ ...o, foto_url: null, activo: true }))
      case 'productos':
        return [...PRODUCTOS, ...PRODUCTOS_FRACCIONADO, GRANEL_DOCUMENTO].map((p) => ({
          ...p, codigo: codigos.get(p.id) ?? null, litros_hora_std: null, activo: true,
        }))
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
          id: e.id, fabricacion_id: e.fabricacion_id, presentacion_id: e.presentacion_id, cantidad: e.cantidad, estado: e.estado, etiqueta_id: e.etiqueta_id,
          granel_id: e.granel_id, lote: e.lote, codigo: e.codigo, descripcion: e.descripcion, litros_granel: e.litros_granel,
          presentaciones: { litros_equiv: presentacion(e.presentacion_id).litros_equiv },
        }))
      default:
        return []
    }
  }

  // Estado inicial: casi todos los tanques con una orden, y la planta "calentada" unas horas.
  if (autonomo) {
    // T-03 arranca siempre con un polvo, para que se vea la bolsa ziplock.
    const polvos = PRODUCTOS.filter((p) => p.tipo === 'polvo')
    // Granel de stock listo para envasar: lo que sugiere el tanque al subir el PDF de envasado de la demo.
    crearGranelStock({ tanque_id: GRANEL_DOCUMENTO.tanque_id, producto_id: GRANEL_DOCUMENTO.id, litros: GRANEL_DOCUMENTO.litros, lote: GRANEL_DOCUMENTO.lote })
    TANQUES.forEach((tq, i) => {
      if (fabAbierta(tq.id)) return
      const forzado = i === 2
      if (forzado || azar() < 0.85) {
        const litros = Math.round((tq.capacidad_l * (0.55 + azar() * 0.35)) / 50) * 50
        insertar('fabricaciones', { tanque_id: tq.id, producto_id: elegir(forzado ? polvos : PRODUCTOS).id, litros })
      }
    })
    avanzar(calentar)
    // Siempre arranca con alguna fabricación esperando control (para que se vea el estado desde el primer cuadro).
    if (!fabs.some((f) => f.estado === 'en_control')) {
      const f = fabs.find((x) => x.estado === 'fabricando' && mpFaltan(x.id) === 0) ?? fabs.find((x) => x.estado === 'cola')
      if (f) {
        if (f.estado === 'cola') accion('fabricacion', f.id, 'iniciar')
        accion('fabricacion', f.id, 'finalizar')
      }
    }
  }

  return {
    ahora: () => t, avanzar, consultar, accion, insertar, crearFormula, cargarMp, corregirCantidad, setVencimiento,
    usuarios: () => [{ ...ENCARGADA }],
    registrarControl,
    liberadoras: () => [{ id: ENCARGADA.id, nombre: ENCARGADA.nombre }],
    crearGranelStock, crearEnvasadoDocumento, crearFraccionadoDocumento, cargarConsumible, editarEnvasado,
  }
}
