import type { FilaHistorial } from './historial'
import { cantidadEfectiva } from './participaciones'

// Productividad por operaria, mes a mes, en la misma producción (mismo producto; en envasado, misma presentación).
// Cada tramo de una operaria en una orden (participación) trae lo que declaró y sus minutos efectivos
// (sin las pausas de la orden): la tasa es cantidad / hora. Así se compara a cada una consigo misma y con el
// equipo sin mezclar productos que van a distinto ritmo.

export type Celda = { cantidad: number; minutos: number; tramos: number; porHora: number | null }
export type FilaProductividad = {
  empleadoId: string
  nombre: string
  meses: (Celda | null)[]
  /** Mes a mes: % de cada mes contra el anterior (null si falta alguno de los dos). */
  variaciones: (number | null)[]
  /** Último mes: % contra la tasa del equipo en ese mes. */
  vsEquipoPct: number | null
}
export type GrupoProductividad = {
  clave: string
  entidad: FilaHistorial['entidad']
  titulo: string
  /** «L/h», «kg/h» o «u/h». */
  unidad: string
  equipo: (Celda | null)[]
  filas: FilaProductividad[]
}

/** Tramos de menos de esto no cuentan: una entrada y salida al toque da tasas absurdas. */
export const MINUTOS_MINIMOS = 5

const mesDe = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' }).slice(0, 7)

/** Los `n` meses (YYYY-MM) que terminan en el mes de `hasta` (YYYY-MM-DD), del más viejo al más nuevo. */
export function mesesHasta(hasta: string, n: number): string[] {
  const [a, m] = hasta.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (n - 1 - i), 1))
    return d.toISOString().slice(0, 7)
  })
}

/** Del 1.º del primer mes al último día del último (para cargar el historial). */
export function rangoDeMeses(meses: string[]): { desde: string; hasta: string } {
  const [a, m] = meses[meses.length - 1].split('-').map(Number)
  return { desde: `${meses[0]}-01`, hasta: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** «nov 26». */
export const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`

const redondear = (n: number) => Math.round(n * 10) / 10
const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : Math.round(((a - b) / b) * 100))
const tasa = (c: Celda | null) => c?.porHora ?? null

function sumar(c: Celda | null, cantidad: number, minutos: number): Celda {
  const n = c ?? { cantidad: 0, minutos: 0, tramos: 0, porHora: null }
  n.cantidad += cantidad
  n.minutos += minutos
  n.tramos += 1
  n.porHora = n.minutos > 0 ? redondear((n.cantidad / n.minutos) * 60) : null
  return n
}

function produccion(f: FilaHistorial): { clave: string; titulo: string } {
  const producto = f.producto ?? f.descripcion ?? '?'
  if (f.entidad === 'fabricacion') return { clave: `fabricacion|${producto}`, titulo: `Fabricación · ${producto}` }
  if (f.entidad === 'envasado')
    return { clave: `envasado|${producto}|${f.presentacion ?? ''}`, titulo: `Envasado · ${producto} ${f.presentacion ?? ''}`.trim() }
  const nombre = f.descripcion ?? producto
  return { clave: `fraccionado|${nombre}`, titulo: `Fraccionado · ${nombre}` }
}

export function productividadMensual(filas: FilaHistorial[], meses: string[]): GrupoProductividad[] {
  const indice = new Map(meses.map((m, i) => [m, i]))
  const grupos = new Map<
    string,
    { base: Omit<GrupoProductividad, 'equipo' | 'filas'>; equipo: (Celda | null)[]; personas: Map<string, { nombre: string; meses: (Celda | null)[] }> }
  >()

  for (const f of filas) {
    if (f.estado === 'cancelada' || f.estado === 'cancelado') continue
    if (f.entidad === 'fabricacion' && f.origen === 'stock') continue
    // Envasado: en unidades de la presentación si se sabe cuántos litros lleva cada una.
    const porUnidad = f.entidad === 'envasado' && f.litros_equiv && f.litros_equiv > 0 ? f.litros_equiv : null
    for (const p of f.participaciones ?? []) {
      const c = cantidadEfectiva(p)
      const i = indice.get(mesDe(p.desde))
      if (p.hasta === null || c === null || c <= 0 || p.minutos < MINUTOS_MINIMOS || i === undefined) continue
      const unidadTramo = p.unidad ?? 'L'
      const enUnidades = porUnidad !== null && unidadTramo === 'L'
      const unidad = enUnidades ? 'u/h' : `${unidadTramo}/h`
      const { clave: base, titulo } = produccion(f)
      const clave = `${base}|${unidad}`
      const g = grupos.get(clave) ?? {
        base: { clave, entidad: f.entidad, titulo, unidad },
        equipo: meses.map(() => null),
        personas: new Map(),
      }
      const cantidad = enUnidades ? c / porUnidad : c
      g.equipo[i] = sumar(g.equipo[i], cantidad, p.minutos)
      const o = g.personas.get(p.empleado_id) ?? { nombre: p.nombre, meses: meses.map(() => null) }
      o.meses[i] = sumar(o.meses[i], cantidad, p.minutos)
      g.personas.set(p.empleado_id, o)
      grupos.set(clave, g)
    }
  }

  const ultimo = meses.length - 1
  return [...grupos.values()]
    .map(({ base, equipo, personas }) => ({
      ...base,
      equipo,
      filas: [...personas.entries()]
        .map(([empleadoId, o]) => ({
          empleadoId,
          nombre: o.nombre,
          meses: o.meses,
          variaciones: o.meses.map((c, i) => (i === 0 ? null : pct(tasa(c), tasa(o.meses[i - 1])))),
          vsEquipoPct: pct(tasa(o.meses[ultimo]), tasa(equipo[ultimo])),
        }))
        // Las del último mes primero, de la más rápida a la más lenta; después el resto por nombre.
        .sort((a, b) => (tasa(b.meses[ultimo]) ?? -1) - (tasa(a.meses[ultimo]) ?? -1) || a.nombre.localeCompare(b.nombre)),
    }))
    .sort((a, b) => b.equipo.reduce((s, c) => s + (c?.tramos ?? 0), 0) - a.equipo.reduce((s, c) => s + (c?.tramos ?? 0), 0))
}
