import { useMemo, useState } from 'react'
import { normalizar } from '../../domain/historial'
import { MINUTOS_MINIMOS, nombreMes, type Celda, type GrupoProductividad } from '../../domain/productividad'

const TIPOS = { '': 'Todas', fabricacion: 'Fabricación', envasado: 'Envasado', fraccionado: 'Fraccionado' } as const
type Tipo = keyof typeof TIPOS

/** Menos de una hora en el mes: el número sirve de referencia, no para sacar conclusiones. */
const POCOS_MINUTOS = 60

const num = (n: number) => n.toLocaleString('es-UY', { maximumFractionDigits: 1 })
const horas = (min: number) => (min / 60).toLocaleString('es-UY', { maximumFractionDigits: 1 })

// Más rápido es mejor: verde si sube, rojo si baja; ±5 % es lo mismo.
const claseCambio = (p: number) => (p > 5 ? 'prod-sube' : p < -5 ? 'prod-baja' : 'prod-igual')
const flecha = (p: number) => (p > 5 ? '▲' : p < -5 ? '▼' : '=')

const poca = (c: Celda | null) => !!c && c.minutos < POCOS_MINUTOS

/** `dudoso`: alguno de los dos meses tiene pocos datos; la flecha va en gris para no sacar conclusiones. */
function Cambio({ pct, titulo, dudoso = false }: { pct: number | null; titulo: string; dudoso?: boolean }) {
  if (pct === null) return null
  return (
    <span className={`prod-cambio ${dudoso ? 'prod-dudoso' : claseCambio(pct)}`} title={dudoso ? `${titulo} · pocos datos` : titulo}>
      {flecha(pct)} {pct > 0 ? '+' : ''}
      {pct} %
    </span>
  )
}

function Valor({ c }: { c: Celda | null }) {
  if (!c || c.porHora === null) return <span className="prod-nada">—</span>
  const pocos = poca(c)
  return (
    <span
      className={`prod-valor${pocos ? ' prod-poca' : ''}`}
      title={`${num(c.cantidad)} en ${horas(c.minutos)} h · ${c.tramos} ${c.tramos === 1 ? 'tramo' : 'tramos'}${pocos ? ' · pocos datos' : ''}`}
    >
      {num(c.porHora)}
    </span>
  )
}

export function Productividad({ grupos, meses, cargando }: { grupos: GrupoProductividad[]; meses: string[]; cargando: boolean }) {
  const [tipo, setTipo] = useState<Tipo>('')
  const [texto, setTexto] = useState('')
  const ultimo = meses.length - 1

  const visibles = useMemo(() => {
    const t = normalizar(texto.trim())
    return grupos
      .filter((g) => !tipo || g.entidad === tipo)
      .map((g) => (!t || normalizar(g.titulo).includes(t) ? g : { ...g, filas: g.filas.filter((f) => normalizar(f.nombre).includes(t)) }))
      .filter((g) => g.filas.length > 0)
  }, [grupos, tipo, texto])

  return (
    <div className="productividad">
      <div className="filtros">
        <div className="campo">
          <label htmlFor="p-tipo">Producción</label>
          <select id="p-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
            {Object.entries(TIPOS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="p-buscar">Buscar operaria o producto</label>
          <input id="p-buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      </div>
      <p className="prod-nota">
        Lo que declaró cada operaria por hora efectiva (sin pausas), en la misma producción. Envasado en unidades por hora.
        Últimos {meses.length} meses hasta {nombreMes(meses[ultimo])}; la flecha compara con el mes anterior y «vs. equipo» con el
        promedio de todas en {nombreMes(meses[ultimo])}. No cuentan tramos de menos de {MINUTOS_MINIMOS} min; en gris, menos de una
        hora en el mes.
      </p>

      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : visibles.length === 0 ? (
        <p className="vacio">No hay cantidades declaradas por operaria en estos meses.</p>
      ) : (
        visibles.map((g) => (
          <section key={g.clave} className="prod-grupo" aria-label={g.titulo}>
            <h3>
              {g.titulo} <span className="prod-unidad">{g.unidad}</span>
            </h3>
            <div className="tabla-scroll">
              <table className="tabla tabla-prod">
                <thead>
                  <tr>
                    <th scope="col">Operaria</th>
                    {meses.map((m) => (
                      <th key={m} scope="col">
                        {nombreMes(m)}
                      </th>
                    ))}
                    <th scope="col">vs. equipo</th>
                  </tr>
                </thead>
                <tbody>
                  {g.filas.map((f) => (
                    <tr key={f.empleadoId}>
                      <th scope="row">{f.nombre}</th>
                      {f.meses.map((c, i) => (
                        <td key={meses[i]}>
                          <Valor c={c} />
                          <Cambio
                            pct={f.variaciones[i]}
                            titulo={`Contra ${nombreMes(meses[i - 1] ?? meses[i])}`}
                            dudoso={poca(c) || poca(f.meses[i - 1] ?? null)}
                          />
                        </td>
                      ))}
                      <td>
                        {f.vsEquipoPct === null ? (
                          <span className="prod-nada">—</span>
                        ) : (
                          <Cambio pct={f.vsEquipoPct} titulo={`Contra el equipo en ${nombreMes(meses[ultimo])}`} dudoso={poca(f.meses[ultimo])} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Equipo</th>
                    {g.equipo.map((c, i) => (
                      <td key={meses[i]}>
                        <Valor c={c} />
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
