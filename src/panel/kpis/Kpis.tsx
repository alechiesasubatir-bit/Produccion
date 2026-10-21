import { useEffect, useMemo, useState } from 'react'
import { aCSV, descargarCSV, type ColumnaCSV } from '../../domain/csv'
import { hoyMontevideo, rangoDe, type FilaHistorial, type Rango } from '../../domain/historial'
import { porProducto, rankingOperarias, resumenOperaciones, tiemposVsEstandar, type Estandar } from '../../domain/kpis'
import { mensajeError } from '../../lib/errores'
import { cargarEstandares, cargarHistorial } from '../historial/datosHistorial'
import { SelectorRango } from '../historial/SelectorRango'
import { Contador } from '../KpisFlujo'

type Pestana = 'operaciones' | 'productos' | 'ranking' | 'tiempos'

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'operaciones', texto: 'Operaciones' },
  { id: 'productos', texto: 'Productos' },
  { id: 'ranking', texto: 'Ranking' },
  { id: 'tiempos', texto: 'Tiempos vs. estándar' },
]

const MEDALLAS = ['🥇', '🥈', '🥉']
const num = (n: number | null) => (n === null ? '—' : n.toLocaleString('es-UY'))
const horas = (min: number) => (min / 60).toLocaleString('es-UY', { maximumFractionDigits: 1 })

// Una tabla genérica: columnas con título, celda y valor para el CSV.
type Col<T> = { titulo: string; celda: (f: T, i: number) => React.ReactNode; csv: ColumnaCSV<T>['valor'] }

function Tabla<T>({ columnas, filas, clave }: { columnas: Col<T>[]; filas: T[]; clave: (f: T) => string }) {
  if (filas.length === 0) return <p className="vacio">No hay datos en este rango.</p>
  return (
    <table className="tabla">
      <thead>
        <tr>
          {columnas.map((c) => (
            <th key={c.titulo} scope="col">
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={clave(f)}>
            {columnas.map((c) => (
              <td key={c.titulo}>{c.celda(f, i)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type Ranking = ReturnType<typeof rankingOperarias>[number]
type Producto = ReturnType<typeof porProducto>[number]
type Tiempo = ReturnType<typeof tiemposVsEstandar>[number]
type Operacion = { concepto: string; valor: number }

const COL_RANKING: Col<Ranking>[] = [
  { titulo: '#', celda: (_, i) => MEDALLAS[i] ?? i + 1, csv: () => null },
  { titulo: 'Operaria', celda: (f) => f.nombre, csv: (f) => f.nombre },
  { titulo: 'Tareas', celda: (f) => num(f.tareas), csv: (f) => f.tareas },
  { titulo: 'Unidades', celda: (f) => num(f.unidades), csv: (f) => f.unidades },
  { titulo: 'u/min', celda: (f) => num(f.unidadesPorMin), csv: (f) => f.unidadesPorMin },
  { titulo: 'Horas', celda: (f) => horas(f.minutos), csv: (f) => Math.round((f.minutos / 60) * 10) / 10 },
]
const COL_PRODUCTOS: Col<Producto>[] = [
  { titulo: 'Producto', celda: (f) => f.producto, csv: (f) => f.producto },
  { titulo: 'Presentación', celda: (f) => f.presentacion, csv: (f) => f.presentacion },
  { titulo: 'Tareas', celda: (f) => num(f.tareas), csv: (f) => f.tareas },
  { titulo: 'Unidades', celda: (f) => num(f.unidades), csv: (f) => f.unidades },
  { titulo: 'Litros', celda: (f) => num(f.litros), csv: (f) => f.litros },
  { titulo: 'u/min', celda: (f) => num(f.unidadesPorMin), csv: (f) => f.unidadesPorMin },
]
const claseDesvio = (d: number | null) => (d === null ? '' : d <= 0 ? 'desvio-ok' : d <= 20 ? 'desvio-medio' : 'desvio-alto')
const COL_TIEMPOS: Col<Tiempo>[] = [
  { titulo: 'Producto', celda: (f) => f.producto, csv: (f) => f.producto },
  { titulo: 'Real (L/min)', celda: (f) => num(f.real), csv: (f) => f.real },
  { titulo: 'Estándar (L/min)', celda: (f) => num(f.estandar), csv: (f) => f.estandar },
  {
    titulo: 'Desvío',
    celda: (f) => (f.desvioPct === null ? '—' : <span className={claseDesvio(f.desvioPct)}>{f.desvioPct} %</span>),
    csv: (f) => f.desvioPct,
  },
]
const COL_OPERACIONES: Col<Operacion>[] = [
  { titulo: 'Concepto', celda: (f) => f.concepto, csv: (f) => f.concepto },
  { titulo: 'Valor', celda: (f) => num(f.valor), csv: (f) => f.valor },
]

export function Kpis() {
  const [rango, setRango] = useState<Rango>(() => rangoDe('mes', hoyMontevideo()))
  const [pestana, setPestana] = useState<Pestana>('operaciones')
  const [filas, setFilas] = useState<FilaHistorial[]>([])
  const [estandares, setEstandares] = useState<Estandar[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    Promise.all([cargarHistorial(rango), cargarEstandares()]).then(
      ([f, e]) => {
        if (!vigente) return
        setFilas(f)
        setEstandares(e)
        setError(null)
      },
      (e: unknown) => vigente && setError(mensajeError(e).texto),
    )
    return () => {
      vigente = false
    }
  }, [rango])

  const resumen = useMemo(() => resumenOperaciones(filas), [filas])
  const ranking = useMemo(() => rankingOperarias(filas), [filas])
  const productos = useMemo(() => porProducto(filas), [filas])
  const tiempos = useMemo(() => tiemposVsEstandar(filas, estandares), [filas, estandares])
  const operaciones: Operacion[] = [
    { concepto: 'Fabricaciones terminadas', valor: resumen.fabricaciones },
    { concepto: 'Envasados terminados', valor: resumen.envasados },
    { concepto: 'Fraccionados terminados', valor: resumen.fraccionados },
    { concepto: 'Litros fabricados', valor: resumen.litrosFabricados },
    { concepto: 'Unidades envasadas', valor: resumen.unidadesEnvasadas },
    { concepto: 'Horas efectivas', valor: Math.round((resumen.minutosEfectivos / 60) * 10) / 10 },
    { concepto: 'Horas en pausa', valor: Math.round((resumen.minutosPausa / 60) * 10) / 10 },
  ]

  const exportar = () => {
    const nombre = `prodcontrol-kpis-${pestana}-${rango.desde}_${rango.hasta}.csv`
    const a = <T,>(cols: Col<T>[], f: T[]) => aCSV(cols.map((c) => ({ titulo: c.titulo, valor: c.csv })), f)
    const contenido =
      pestana === 'ranking'
        ? a(COL_RANKING.slice(1), ranking)
        : pestana === 'productos'
          ? a(COL_PRODUCTOS, productos)
          : pestana === 'tiempos'
            ? a(COL_TIEMPOS, tiempos)
            : a(COL_OPERACIONES, operaciones)
    descargarCSV(nombre, contenido)
  }

  return (
    <div className="kpis-vista">
      <div className="vista-barra">
        <h1 className="titulo-panel">KPIs</h1>
        <button type="button" className="boton" onClick={exportar}>
          Exportar CSV
        </button>
      </div>
      <div className="filtros">
        <SelectorRango rango={rango} onCambiar={setRango} />
      </div>
      {error && (
        <p className="aviso-panel" role="alert">
          {error}
        </p>
      )}

      <dl className="kpis kpis-grandes">
        {(
          [
            [resumen.litrosFabricados, 'litros fabricados'],
            [resumen.unidadesEnvasadas, 'unidades envasadas'],
            [resumen.fabricaciones + resumen.envasados + resumen.fraccionados, 'tareas terminadas'],
            [Math.round(resumen.minutosEfectivos / 60), 'horas efectivas'],
          ] as const
        ).map(([v, t]) => (
          <div key={t} className="kpi">
            <dd>
              <Contador valor={v} />
            </dd>
            <dt>{t}</dt>
          </div>
        ))}
      </dl>

      <nav className="segmentos" aria-label="Indicadores">
        {PESTANAS.map((p) => (
          <button key={p.id} type="button" className="segmento" aria-pressed={pestana === p.id} onClick={() => setPestana(p.id)}>
            {p.texto}
          </button>
        ))}
      </nav>

      {pestana === 'operaciones' && <Tabla columnas={COL_OPERACIONES} filas={operaciones} clave={(f) => f.concepto} />}
      {pestana === 'productos' && <Tabla columnas={COL_PRODUCTOS} filas={productos} clave={(f) => `${f.producto}|${f.presentacion}`} />}
      {pestana === 'ranking' && <Tabla columnas={COL_RANKING} filas={ranking} clave={(f) => f.nombre} />}
      {pestana === 'tiempos' && <Tabla columnas={COL_TIEMPOS} filas={tiempos} clave={(f) => f.producto} />}
    </div>
  )
}
