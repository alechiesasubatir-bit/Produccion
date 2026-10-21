import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Entidad } from '../../domain/acciones'
import { aCSV, descargarCSV, type ColumnaCSV } from '../../domain/csv'
import {
  filtrarHistorial,
  hoyMontevideo,
  moverRango,
  ordenarHistorial,
  rangoDe,
  type FilaHistorial,
  type Rango,
} from '../../domain/historial'
import { formatoCronometro } from '../../domain/tareas'
import { mensajeError } from '../../lib/errores'
import { Chip } from '../../ui/Chip'
import { Calendario, tituloRango } from './Calendario'
import { cargarHistorial } from './datosHistorial'
import { SelectorRango } from './SelectorRango'

type Vista = 'tabla' | 'mes' | 'semana'

const TIPOS: Record<Entidad, string> = { fabricacion: 'Fabricación', envasado: 'Envasado', fraccionado: 'Fraccionado' }
const ESTADOS = ['cola', 'fabricando', 'pausada', 'para_envasar', 'finalizada', 'activo', 'pausado', 'finalizado', 'cancelada', 'cancelado']

export const fechaHora = (ts: string | null) =>
  ts
    ? new Date(ts).toLocaleString('es-UY', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Montevideo',
      })
    : ''
const minutos = (m: number | null) => (m === null ? '' : formatoCronometro(Math.round(m * 60)))
const cantidad = (f: FilaHistorial) => (f.entidad === 'fabricacion' ? `${f.litros ?? '?'} L` : `${f.cantidad ?? '?'} u`)
const operarias = (f: FilaHistorial) => [f.operaria_1_nombre, f.operaria_2_nombre].filter(Boolean).join(' · ')

type Columna = { clave: keyof FilaHistorial; titulo: string; celda: (f: FilaHistorial) => React.ReactNode }

const COLUMNAS: Columna[] = [
  { clave: 'dia', titulo: 'Día', celda: (f) => f.dia.split('-').reverse().slice(0, 2).join('/') },
  { clave: 'entidad', titulo: 'Tipo', celda: (f) => TIPOS[f.entidad] },
  { clave: 'producto', titulo: 'Producto', celda: (f) => f.producto ?? '—' },
  { clave: 'presentacion', titulo: 'Presentación', celda: (f) => f.presentacion ?? '—' },
  { clave: 'litros', titulo: 'Cant./Litros', celda: cantidad },
  { clave: 'lote', titulo: 'Lote', celda: (f) => f.lote ?? '—' },
  { clave: 'tanque_codigo', titulo: 'Tanque', celda: (f) => f.tanque_codigo ?? '—' },
  { clave: 'operaria_1_nombre', titulo: 'Operaria(s)', celda: (f) => operarias(f) || '—' },
  { clave: 'inicio', titulo: 'Inicio', celda: (f) => fechaHora(f.inicio) },
  { clave: 'fin', titulo: 'Fin', celda: (f) => fechaHora(f.fin) },
  { clave: 'min_efectivos', titulo: 'Efectivo', celda: (f) => minutos(f.min_efectivos) },
  { clave: 'min_pausa', titulo: 'Pausas', celda: (f) => minutos(f.min_pausa) },
  { clave: 'estado', titulo: 'Estado', celda: (f) => <Chip estado={f.estado} /> },
]

const CSV: ColumnaCSV<FilaHistorial>[] = [
  { titulo: 'Día', valor: (f) => f.dia },
  { titulo: 'Tipo', valor: (f) => TIPOS[f.entidad] },
  { titulo: 'Producto', valor: (f) => f.producto },
  { titulo: 'Presentación', valor: (f) => f.presentacion },
  { titulo: 'Cantidad', valor: (f) => f.cantidad },
  { titulo: 'Litros', valor: (f) => f.litros },
  { titulo: 'Lote', valor: (f) => f.lote },
  { titulo: 'Tanque', valor: (f) => f.tanque_codigo },
  { titulo: 'Operaria(s)', valor: operarias },
  { titulo: 'Inicio', valor: (f) => fechaHora(f.inicio) },
  { titulo: 'Fin', valor: (f) => fechaHora(f.fin) },
  { titulo: 'Minutos efectivos', valor: (f) => (f.min_efectivos === null ? null : Math.round(f.min_efectivos)) },
  { titulo: 'Minutos de pausa', valor: (f) => (f.min_pausa === null ? null : Math.round(f.min_pausa)) },
  { titulo: 'Estado', valor: (f) => f.estado },
]

const ABIERTA = ['cola', 'fabricando', 'pausada', 'para_envasar']

export function Historial() {
  const navegar = useNavigate()
  const [rango, setRango] = useState<Rango>(() => rangoDe('mes', hoyMontevideo()))
  const [vista, setVista] = useState<Vista>('tabla')
  const [filas, setFilas] = useState<FilaHistorial[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entidad, setEntidad] = useState<Entidad | ''>('')
  const [estado, setEstado] = useState('')
  const [texto, setTexto] = useState('')
  const [orden, setOrden] = useState<{ por: keyof FilaHistorial; asc: boolean } | null>(null)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    cargarHistorial(rango).then(
      (f) => {
        if (!vigente) return
        setFilas(f)
        setError(null)
        setCargando(false)
      },
      (e: unknown) => {
        if (!vigente) return
        setError(mensajeError(e).texto)
        setCargando(false)
      },
    )
    return () => {
      vigente = false
    }
  }, [rango])

  const visibles = useMemo(() => {
    const f = filtrarHistorial(filas, { entidad, estado, texto })
    return orden ? ordenarHistorial(f, orden.por, orden.asc) : f
  }, [filas, entidad, estado, texto, orden])

  const cambiarVista = (v: Vista) => {
    setVista(v)
    if (v !== 'tabla') setRango(moverRango(rango, v, 0))
  }

  const ordenarPor = (por: keyof FilaHistorial) =>
    setOrden((o) => (o?.por === por ? { por, asc: !o.asc } : { por, asc: true }))

  const exportar = () =>
    descargarCSV(`prodcontrol-historial-${rango.desde}_${rango.hasta}.csv`, aCSV(CSV, visibles))

  return (
    <div className="historial">
      <div className="vista-barra">
        <h1 className="titulo-panel">Historial</h1>
        <div className="segmentos" role="group" aria-label="Vista">
          {(['tabla', 'mes', 'semana'] as const).map((v) => (
            <button key={v} type="button" className="segmento" aria-pressed={vista === v} onClick={() => cambiarVista(v)}>
              {v === 'tabla' ? 'Tabla' : v === 'mes' ? 'Mes' : 'Semana'}
            </button>
          ))}
        </div>
        <button type="button" className="boton" onClick={exportar} disabled={visibles.length === 0}>
          Exportar CSV
        </button>
      </div>

      <div className="filtros">
        {vista === 'tabla' ? (
          <SelectorRango rango={rango} onCambiar={setRango} />
        ) : (
          <div className="navegador-periodo">
            <button type="button" className="boton-mini" aria-label="Anterior" onClick={() => setRango(moverRango(rango, vista, -1))}>
              ‹
            </button>
            <strong>{tituloRango(vista, rango)}</strong>
            <button type="button" className="boton-mini" aria-label="Siguiente" onClick={() => setRango(moverRango(rango, vista, 1))}>
              ›
            </button>
          </div>
        )}
        <div className="campo">
          <label htmlFor="h-tipo">Tipo</label>
          <select id="h-tipo" value={entidad} onChange={(e) => setEntidad(e.target.value as Entidad | '')}>
            <option value="">Todos</option>
            {Object.entries(TIPOS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="h-estado">Estado</label>
          <select id="h-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="h-buscar">Buscar</label>
          <input id="h-buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      </div>

      {error && (
        <p className="aviso-panel" role="alert">
          {error}
        </p>
      )}

      {vista === 'tabla' ? (
        <div className="tabla-scroll">
          <table className="tabla tabla-densa">
            <thead>
              <tr>
                {COLUMNAS.map((c) => (
                  <th
                    key={c.clave}
                    scope="col"
                    aria-sort={orden?.por === c.clave ? (orden.asc ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" className="th-orden" onClick={() => ordenarPor(c.clave)}>
                      {c.titulo}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const irAlTanque = f.entidad === 'fabricacion' && ABIERTA.includes(f.estado) && f.tanque_codigo
                return (
                  <tr
                    key={`${f.entidad}-${f.id}`}
                    className={irAlTanque ? 'fila-enlace' : ''}
                    onClick={irAlTanque ? () => navegar(`/panel/tanques?tanque=${encodeURIComponent(f.tanque_codigo!)}`) : undefined}
                  >
                    {COLUMNAS.map((c) => (
                      <td key={c.clave}>{c.celda(f)}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!cargando && visibles.length === 0 && <p className="vacio">No hay tareas en este rango.</p>}
        </div>
      ) : (
        <Calendario
          modo={vista}
          rango={rango}
          filas={visibles}
          onElegirDia={(dia) => {
            setRango({ desde: dia, hasta: dia })
            setVista('tabla')
          }}
        />
      )}
    </div>
  )
}
