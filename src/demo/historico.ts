// Histórico de la DEMO: tareas ya terminadas en los meses anteriores al día simulado, con las mismas
// columnas que v_historial. Solo alimenta KPIs (Productividad compara mes a mes); no toca el flujo vivo.
// Cada operaria tiene su ritmo y una tendencia mensual, así la comparación muestra quién mejora y quién no.
import { azarCon } from './azar'
import {
  LITROS_ENV_POR_MIN,
  LITROS_FAB_POR_MIN,
  OPERARIAS,
  PRESENTACIONES,
  PRODUCTOS,
  PRODUCTOS_FRACCIONADO,
  UNIDADES_FRAC_POR_MIN,
  type ProductoDemo,
} from './catalogo'

type Fila = Record<string, unknown>

const MIN = 60_000
const DIA = 24 * 60 * MIN
const MVD = 3 * 60 * MIN // Montevideo, UTC-3

/** Envasados habituales (producto × presentación): se repiten todos los meses para poder compararlos. */
const ENVASADOS: [string, string][] = [
  ['dp1', 'dr3'], ['dp2', 'dr2'], ['dp4', 'dr2'], ['dp5', 'dr4'], ['dp8', 'dr3'],
  ['dp10', 'dr4'], ['dp6', 'dr1'], ['dp3', 'dr1'], ['dp7', 'dr7'], ['dp9', 'dr2'],
]
/** Fabricaciones: ritmo relativo al estándar por tipo (un gel va más lento que un líquido). */
const RITMO_TIPO: Record<ProductoDemo['tipo'], number> = { liquido: 1, denso: 0.75, polvo: 0.85 }

export function generarHistorico(opts: { hasta: number; semilla: number; meses: number }): Fila[] {
  const azar = azarCon(opts.semilla ^ 0x5eed)
  const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1))
  const elegir = <T,>(l: T[]): T => l[Math.floor(azar() * l.length)]
  const ruido = (amp: number) => 1 + (azar() * 2 - 1) * amp

  // Día de Montevideo como medianoche UTC (para iterar días sin líos de zona).
  const hoy = new Date(opts.hasta - MVD)
  const hoyUTC = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate())
  const desde = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - (opts.meses - 1), 1)
  const mesIndice = (d: number) => {
    const x = new Date(d)
    return (x.getUTCFullYear() - new Date(desde).getUTCFullYear()) * 12 + x.getUTCMonth() - new Date(desde).getUTCMonth()
  }

  // Perfil de cada operaria: habilidad (±15 %) y tendencia por mes (de −4 % a +5 %).
  const perfil = new Map(OPERARIAS.map((o) => [o.empleado_id, { habilidad: ruido(0.15), tendencia: -0.04 + azar() * 0.09 }]))
  const factor = (empleado: string, mes: number) => {
    const p = perfil.get(empleado)!
    return p.habilidad * (1 + p.tendencia * mes) * ruido(0.06)
  }
  const nombre = (id: string) => OPERARIAS.find((o) => o.empleado_id === id)!.nombre
  const iso = (ms: number) => new Date(ms).toISOString()
  const dia = (ms: number) => new Date(ms - MVD).toISOString().slice(0, 10)

  const filas: Fila[] = []
  let sec = 0
  let lote = 1400

  // Una tarea: reparte la cantidad entre 1 o 2 operarias; cada tramo dura según su ritmo.
  function tarea(
    base: Fila & { entidad: string },
    inicio: number,
    cantidad: number,
    unidad: 'L' | 'kg',
    porMin: number,
    mes: number,
    equipo: string[],
  ) {
    const partes = equipo.map((id, i) => {
      const parte = equipo.length === 1 ? cantidad : i === 0 ? Math.round(cantidad * (0.4 + azar() * 0.2)) : 0
      return { id, parte }
    })
    if (partes.length === 2) partes[1].parte = cantidad - partes[0].parte
    const tramos = partes.map(({ id, parte }) => {
      const minutos = Math.max(6, Math.round((parte / (porMin / equipo.length) / factor(id, mes)) * 10) / 10)
      return { id, parte, minutos }
    })
    const efectivos = Math.max(...tramos.map((t) => t.minutos))
    const pausa = azar() < 0.3 ? entre(5, 25) : 0
    const fin = inicio + (efectivos + pausa) * MIN
    filas.push({
      color: null, tanque_codigo: null, presentacion: null, cantidad: null, litros: null, litros_equiv: null, descripcion: null,
      operaria_1: equipo[0], operaria_1_nombre: nombre(equipo[0]), operaria_2: equipo[1] ?? null, operaria_2_nombre: equipo[1] ? nombre(equipo[1]) : null,
      etiqueta: null, controles: [], lote_doc: null, consumibles: [], origen: null,
      ...base,
      id: `h${++sec}`,
      inicio: iso(inicio), fin: iso(fin), created_at: iso(inicio - entre(10, 90) * MIN),
      min_brutos: Math.round(efectivos + pausa), min_pausa: pausa, min_efectivos: Math.round(efectivos), dia: dia(inicio),
      participaciones: tramos.map((t) => ({
        empleado_id: t.id, nombre: nombre(t.id), desde: iso(inicio), hasta: iso(inicio + t.minutos * MIN),
        cantidad: t.parte, unidad, cantidad_corregida: null, motivo: null, minutos: t.minutos,
      })),
    })
    return fin
  }

  for (let d = desde; d < hoyUTC; d += DIA) {
    const semana = new Date(d).getUTCDay()
    if (semana === 0 || semana === 6) continue
    const mes = mesIndice(d)
    // El turno arranca 7:00 de Montevideo; cada operaria encadena tareas en su propia línea de tiempo.
    const libres = [...OPERARIAS].sort(() => azar() - 0.5).slice(0, entre(8, 11)).map((o) => o.empleado_id)
    const reloj = new Map(libres.map((id) => [id, d + MVD + 7 * 60 * MIN + entre(0, 20) * MIN]))
    const tomar = (n: number) => {
      const ids = [...libres].sort((a, b) => reloj.get(a)! - reloj.get(b)!).slice(0, n)
      return { ids, inicio: Math.max(...ids.map((id) => reloj.get(id)!)) + entre(2, 15) * MIN }
    }
    const fijar = (ids: string[], fin: number) => ids.forEach((id) => reloj.set(id, fin))

    for (let i = 0, n = entre(3, 5); i < n; i++) {
      const p = elegir(PRODUCTOS.filter((x) => x.id !== 'dp13' && x.id !== 'dp14'))
      const litros = entre(8, 30) * 100
      const { ids, inicio } = tomar(1)
      const fin = tarea(
        { entidad: 'fabricacion', estado: 'finalizada', producto: p.nombre, color: p.color, litros, lote: `L-${++lote}`, origen: 'formula', tanque_codigo: `T-${String(entre(1, 16)).padStart(2, '0')}` },
        inicio, litros, 'L', LITROS_FAB_POR_MIN * RITMO_TIPO[p.tipo], mes, ids,
      )
      fijar(ids, fin)
    }
    for (let i = 0, n = entre(5, 8); i < n; i++) {
      const [pid, rid] = elegir(ENVASADOS)
      const p = PRODUCTOS.find((x) => x.id === pid)!
      const pr = PRESENTACIONES.find((x) => x.id === rid)!
      const unidades = entre(4, 16) * Math.round(100 / pr.litros_equiv)
      const litros = Math.round(unidades * pr.litros_equiv)
      const { ids, inicio } = tomar(azar() < 0.55 ? 2 : 1)
      const fin = tarea(
        {
          entidad: 'envasado', estado: 'finalizado', producto: p.nombre, color: p.color, presentacion: pr.nombre, cantidad: unidades,
          litros, litros_equiv: pr.litros_equiv, lote: `L-${lote - entre(0, 3)}`, etiqueta: 'Etiqueta Demo A',
        },
        inicio, litros, 'L', (LITROS_ENV_POR_MIN / 2) * ids.length, mes, ids,
      )
      fijar(ids, fin)
    }
    for (let i = 0, n = entre(1, 3); i < n; i++) {
      const p = elegir(PRODUCTOS_FRACCIONADO)
      const kg = entre(3, 10) * 50
      const { ids, inicio } = tomar(1)
      const fin = tarea(
        { entidad: 'fraccionado', estado: 'finalizado', producto: p.nombre, color: p.color, presentacion: '1kg', cantidad: kg, litros: kg, litros_equiv: 1, lote: `F-${lote}` },
        inicio, kg, 'kg', UNIDADES_FRAC_POR_MIN, mes, ids,
      )
      fijar(ids, fin)
    }
  }
  return filas
}
