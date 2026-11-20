import { useMemo, useState } from 'react'
import { normalizar } from '../../domain/historial'
import {
  MINUTOS_CONFIABLES,
  MINUTOS_MINIMOS,
  nombreMes,
  resumenProductividad,
  type Celda,
  type GrupoProductividad,
  type RankingOperaria,
  type ResumenProductividad,
} from '../../domain/productividad'

const TIPOS = { '': 'Todas', fabricacion: 'Fabricación', envasado: 'Envasado', fraccionado: 'Fraccionado' } as const
type Tipo = keyof typeof TIPOS

const num = (n: number) => n.toLocaleString('es-UY', { maximumFractionDigits: 1 })
const horas = (min: number) => (min / 60).toLocaleString('es-UY', { maximumFractionDigits: 1 })
const conSigno = (p: number) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`

// Más rápido es mejor: verde si sube, rojo si baja; ±5 % es lo mismo.
const claseCambio = (p: number) => (p > 5 ? 'prod-sube' : p < -5 ? 'prod-baja' : 'prod-igual')
const flecha = (p: number) => (p > 5 ? '▲' : p < -5 ? '▼' : '=')

const poca = (c: Celda | null) => !!c && c.minutos < MINUTOS_CONFIABLES
const tasa = (c: Celda | null) => c?.porHora ?? null

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

// ---------- resumen de arriba ----------

function Resumen({ r, mes, mesAntes }: { r: ResumenProductividad; mes: string; mesAntes: string }) {
  const cambioHoras = r.horasAntes > 0 ? Math.round(((r.horas - r.horasAntes) / r.horasAntes) * 100) : null
  const primera = r.ranking[0]
  return (
    <div className="prod-resumen" role="group" aria-label="Resumen">
      <div className="prod-dato">
        <span className="prod-dato-titulo">Horas medidas · {nombreMes(mes)}</span>
        <span className="prod-dato-valor">
          {num(r.horas)}
          <small> h</small>
        </span>
        <span className="prod-dato-pie">
          {cambioHoras === null ? `sin datos en ${nombreMes(mesAntes)}` : `${conSigno(cambioHoras)} vs. ${nombreMes(mesAntes)} (${num(r.horasAntes)} h)`}
        </span>
      </div>
      <div className="prod-dato">
        <span className="prod-dato-titulo">Producciones comparadas</span>
        <span className="prod-dato-valor">{r.producciones}</span>
        <span className="prod-dato-pie">
          {r.operarias} {r.operarias === 1 ? 'operaria' : 'operarias'} en {nombreMes(mes)}
        </span>
      </div>
      <div className="prod-dato">
        <span className="prod-dato-titulo">Contra {nombreMes(mesAntes)}</span>
        <span className="prod-dato-valor prod-dato-par">
          <span>
            <i className="prod-marca prod-marca-sube" aria-hidden="true">▲</i>
            {r.mejoraron}
          </span>
          <span>
            <i className="prod-marca prod-marca-baja" aria-hidden="true">▼</i>
            {r.empeoraron}
          </span>
        </span>
        <span className="prod-dato-pie">mejoraron · bajaron más de 5 %</span>
      </div>
      <div className="prod-dato">
        <span className="prod-dato-titulo">Más rápida que el equipo</span>
        <span className="prod-dato-valor prod-dato-nombre">{primera && primera.pct > 0 ? primera.nombre : '—'}</span>
        <span className="prod-dato-pie">
          {primera && primera.pct > 0
            ? `${conSigno(primera.pct)} en ${primera.producciones} ${primera.producciones === 1 ? 'producción' : 'producciones'}`
            : 'nadie arriba del equipo con 1 h o más'}
        </span>
      </div>
    </div>
  )
}

// ---------- cada operaria contra el equipo (barras divergentes desde 0) ----------

function RankingEquipo({ ranking, mes }: { ranking: RankingOperaria[]; mes: string }) {
  if (ranking.length === 0) return null
  // la escala llega al menos a ±20 % para que una diferencia chica no parezca enorme
  const tope = Math.max(20, ...ranking.map((r) => Math.abs(r.pct)))
  return (
    <section className="prod-ranking" aria-labelledby="prod-ranking-titulo">
      <h3 id="prod-ranking-titulo">Cada operaria contra el equipo · {nombreMes(mes)}</h3>
      <p className="prod-sub">
        Promedio de todas las producciones donde trabajó al menos 1 h, pesado por las horas. 0 es el ritmo del equipo.
      </p>
      <ul className="prod-barras">
        {ranking.map((r) => {
          const ancho = (Math.abs(r.pct) / tope) * 50
          const titulo = `${r.nombre}: ${conSigno(r.pct)} que el equipo · ${r.producciones} ${r.producciones === 1 ? 'producción' : 'producciones'} · ${horas(r.minutos)} h`
          return (
            <li key={r.empleadoId} className="prod-barra-fila" title={titulo}>
              <span className="prod-barra-nombre">{r.nombre}</span>
              <span className="prod-barra-pista" aria-hidden="true">
                <i
                  className={`prod-barra ${r.pct >= 0 ? 'prod-barra-mas' : 'prod-barra-menos'}`}
                  style={r.pct >= 0 ? { left: '50%', width: `${ancho}%` } : { right: '50%', width: `${ancho}%` }}
                />
              </span>
              <span className="prod-barra-valor">{conSigno(r.pct)}</span>
            </li>
          )
        })}
      </ul>
      <div className="prod-barras-eje" aria-hidden="true">
        <span />
        <span className="prod-barras-escala">
          <span>−{tope} %</span>
          <span>equipo</span>
          <span>+{tope} %</span>
        </span>
        <span />
      </div>
    </section>
  )
}

// ---------- tendencia mes a mes (sparkline) ----------

const SP_ANCHO = 96
const SP_ALTO = 28

function Tendencia({ celdas, escala, equipo, nombre }: { celdas: (Celda | null)[]; escala: [number, number]; equipo?: (Celda | null)[]; nombre: string }) {
  const [min, max] = escala
  const x = (i: number) => 4 + (i * (SP_ANCHO - 8)) / Math.max(1, celdas.length - 1)
  const y = (v: number) => (max === min ? SP_ALTO / 2 : 4 + (1 - (v - min) / (max - min)) * (SP_ALTO - 8))
  // tramos de línea entre meses con dato; un mes vacío corta la línea
  const trazos = (cs: (Celda | null)[]) => {
    const out: string[] = []
    let actual: string[] = []
    cs.forEach((c, i) => {
      const v = tasa(c)
      if (v === null) {
        if (actual.length > 1) out.push(actual.join(' '))
        actual = []
      } else actual.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    })
    if (actual.length > 1) out.push(actual.join(' '))
    return out
  }
  const ultimo = celdas.reduce<number>((u, c, i) => (tasa(c) !== null ? i : u), -1)
  const valores = celdas.map(tasa).filter((v): v is number => v !== null)
  if (valores.length === 0) return <span className="prod-nada">—</span>
  return (
    <svg className="prod-tendencia" width={SP_ANCHO} height={SP_ALTO} viewBox={`0 0 ${SP_ANCHO} ${SP_ALTO}`} role="img">
      <title>{`Tendencia de ${nombre}: ${valores.map(num).join(' → ')}`}</title>
      {equipo && trazos(equipo).map((p) => <polyline key={`e${p}`} points={p} className="prod-tendencia-equipo" />)}
      {trazos(celdas).map((p) => (
        <polyline key={p} points={p} className="prod-tendencia-linea" />
      ))}
      {celdas.map((c, i) => {
        const v = tasa(c)
        if (v === null) return null
        // un mes suelto (sin vecinos) también se ve
        return <circle key={i} cx={x(i)} cy={y(v)} r={i === ultimo ? 3.5 : 1.75} className={i === ultimo ? 'prod-tendencia-fin' : 'prod-tendencia-punto'} />
      })}
    </svg>
  )
}

/** Barra del último mes contra la marca del equipo, en la escala de la producción. */
function Bala({ c, equipo, max }: { c: Celda | null; equipo: number | null; max: number }) {
  const v = tasa(c)
  if (v === null || max <= 0) return null
  return (
    <span className="prod-bala" aria-hidden="true">
      <i className={`prod-bala-barra${poca(c) ? ' prod-bala-poca' : ''}`} style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
      {equipo !== null && <i className="prod-bala-equipo" style={{ left: `${Math.min(100, (equipo / max) * 100)}%` }} />}
    </span>
  )
}

function Grupo({ g, meses }: { g: GrupoProductividad; meses: string[] }) {
  const u = meses.length - 1
  const todas = [...g.equipo, ...g.filas.flatMap((f) => f.meses)].map(tasa).filter((v): v is number => v !== null)
  const lo = Math.min(...todas)
  const hi = Math.max(...todas)
  const margen = (hi - lo) * 0.1 || hi * 0.1
  const escala: [number, number] = [Math.max(0, lo - margen), hi + margen]
  const equipoUltimo = tasa(g.equipo[u])
  const equipoAntes = tasa(g.equipo[u - 1] ?? null)
  const cambioEquipo = equipoUltimo !== null && equipoAntes ? Math.round(((equipoUltimo - equipoAntes) / equipoAntes) * 100) : null

  return (
    <section className="prod-grupo" aria-label={g.titulo}>
      <header className="prod-grupo-cabeza">
        <h3>
          {g.titulo} <span className="prod-unidad">{g.unidad}</span>
        </h3>
        <span className="prod-grupo-equipo">
          Equipo {nombreMes(meses[u])}: <b>{equipoUltimo === null ? '—' : `${num(equipoUltimo)} ${g.unidad}`}</b>
          <Cambio pct={cambioEquipo} titulo={`Equipo contra ${nombreMes(meses[u - 1] ?? meses[u])}`} dudoso={poca(g.equipo[u]) || poca(g.equipo[u - 1] ?? null)} />
        </span>
      </header>
      <div className="tabla-scroll">
        <table className="tabla tabla-prod">
          <thead>
            <tr>
              <th scope="col">Operaria</th>
              <th scope="col" className="prod-col-tendencia">
                Tendencia
              </th>
              {meses.map((m) => (
                <th key={m} scope="col">
                  {nombreMes(m)}
                </th>
              ))}
              <th scope="col" className="prod-col-equipo">
                vs. equipo
              </th>
            </tr>
          </thead>
          <tbody>
            {g.filas.map((f) => (
              <tr key={f.empleadoId}>
                <th scope="row">{f.nombre}</th>
                <td className="prod-col-tendencia">
                  <Tendencia celdas={f.meses} escala={escala} equipo={g.equipo} nombre={f.nombre} />
                </td>
                {f.meses.map((c, i) => (
                  <td key={meses[i]}>
                    <Valor c={c} />
                    <Cambio pct={f.variaciones[i]} titulo={`Contra ${nombreMes(meses[i - 1] ?? meses[i])}`} dudoso={poca(c) || poca(f.meses[i - 1] ?? null)} />
                  </td>
                ))}
                <td className="prod-col-equipo">
                  <Bala c={f.meses[u]} equipo={equipoUltimo} max={escala[1]} />
                  {f.vsEquipoPct === null ? (
                    <span className="prod-nada">—</span>
                  ) : (
                    <Cambio pct={f.vsEquipoPct} titulo={`Contra el equipo en ${nombreMes(meses[u])}`} dudoso={poca(f.meses[u])} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Equipo</th>
              <td className="prod-col-tendencia">
                <Tendencia celdas={g.equipo} escala={escala} nombre="el equipo" />
              </td>
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

  const resumen = useMemo(() => resumenProductividad(visibles, meses), [visibles, meses])

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

      {cargando ? (
        <p className="vacio">Cargando…</p>
      ) : visibles.length === 0 ? (
        <p className="vacio">No hay cantidades declaradas por operaria en estos meses.</p>
      ) : (
        <>
          <Resumen r={resumen} mes={meses[ultimo]} mesAntes={meses[ultimo - 1] ?? meses[ultimo]} />
          <RankingEquipo ranking={resumen.ranking} mes={meses[ultimo]} />
          <details className="prod-nota">
            <summary>Cómo se calcula</summary>
            <p>
              Lo que declaró cada operaria por hora efectiva (sin pausas), en la misma producción. Envasado en unidades por hora.
              Últimos {meses.length} meses hasta {nombreMes(meses[ultimo])}; la flecha compara con el mes anterior y «vs. equipo»
              con el promedio de todas en {nombreMes(meses[ultimo])}. En la tendencia, la línea punteada es el equipo; en «vs.
              equipo», la barra es la operaria y la marca vertical el equipo. No cuentan tramos de menos de {MINUTOS_MINIMOS} min;
              en gris, menos de una hora en el mes.
            </p>
          </details>
          {visibles.map((g) => (
            <Grupo key={g.clave} g={g} meses={meses} />
          ))}
        </>
      )}
    </div>
  )
}
