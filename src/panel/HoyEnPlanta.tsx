import { useState } from 'react'
import type { FilaFlujo } from '../domain/flujo'
import { GRUPOS_TANQUE, tanquesPorGrupo, type ResumenDia } from '../domain/flujoDia'
import type { EstadoTanque } from '../domain/tanque'
import { tituloTarea } from '../domain/tareas'
import { ahoraPlanta, horaMontevideo } from '../lib/hora'

const num = (n: number) => n.toLocaleString('es-UY', { maximumFractionDigits: 0 })
const duracion = (min: number) => {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}
const VISIBLES = 8

type Medida = 'litros' | 'unidades'

function PorHora({ r }: { r: ResumenDia }) {
  const [medida, setMedida] = useState<Medida>(r.litros === 0 && r.unidades > 0 ? 'unidades' : 'litros')
  const valores = r.porHora.map((h) => h[medida])
  const max = Math.max(...valores)
  const horaActual = Number(horaMontevideo(ahoraPlanta()).slice(0, 2))
  const unidad = medida === 'litros' ? 'L' : 'u'
  return (
    <section className="hoy-panel hoy-horas" aria-labelledby="hoy-horas-titulo">
      <header className="hoy-cabeza">
        <h3 id="hoy-horas-titulo">Terminado por hora</h3>
        <div className="segmentos hoy-segmentos" role="group" aria-label="Medida">
          <button type="button" className="segmento" aria-pressed={medida === 'litros'} onClick={() => setMedida('litros')}>
            Litros
          </button>
          <button type="button" className="segmento" aria-pressed={medida === 'unidades'} onClick={() => setMedida('unidades')}>
            Unidades
          </button>
        </div>
      </header>
      <p className="hoy-total">
        <b>{num(medida === 'litros' ? r.litros : r.unidades)}</b> {medida === 'litros' ? 'litros fabricados' : 'unidades envasadas'} hoy
      </p>
      {max === 0 ? (
        <p className="vacio hoy-vacio">Todavía no terminó nada hoy.</p>
      ) : (
        <div className="hoy-grafico">
          <span className="hoy-eje-max" aria-hidden="true">
            {num(max)} {unidad}
          </span>
          <ol className="hoy-barras" aria-label={`${medida === 'litros' ? 'Litros' : 'Unidades'} terminados por hora`}>
            {r.porHora.map((h) => {
              const v = h[medida]
              const texto = `${String(h.hora).padStart(2, '0')}:00 a ${String(h.hora + 1).padStart(2, '0')}:00 · ${num(v)} ${unidad} · ${h.terminadas} ${h.terminadas === 1 ? 'orden' : 'órdenes'}`
              return (
                <li key={h.hora} className={`hoy-hora${h.hora === horaActual ? ' ahora' : ''}`} title={texto} aria-label={texto}>
                  <span className="hoy-columna">
                    <i style={{ height: v ? `${Math.max(3, (v / max) * 100)}%` : 0 }} />
                  </span>
                  <span className="hoy-hora-texto">{h.hora % 2 === 0 ? h.hora : ''}</span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}

function Terminadas({ filas, proyeccion }: { filas: FilaFlujo[]; proyeccion: (f: FilaFlujo) => number | null }) {
  return (
    <section className="hoy-panel" aria-labelledby="hoy-terminadas-titulo">
      <header className="hoy-cabeza">
        <h3 id="hoy-terminadas-titulo">Últimas terminadas</h3>
        <span className="hoy-contador">{filas.length}</span>
      </header>
      {filas.length === 0 ? (
        <p className="vacio hoy-vacio">Todavía no terminó nada hoy.</p>
      ) : (
        <table className="hoy-tabla">
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col">Producción</th>
              <th scope="col">Tiempo</th>
              <th scope="col">vs. estándar</th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, VISIBLES).map((f) => {
              const proy = proyeccion(f)
              const desvio = proy && f.min_efectivos ? Math.round(((f.min_efectivos - proy) / proy) * 100) : null
              return (
                <tr key={`${f.entidad}-${f.id}`}>
                  <td className="hoy-num">{f.fin ? horaMontevideo(Date.parse(f.fin)) : '—'}</td>
                  <td className="hoy-produccion">
                    <span>
                      <i style={{ background: f.color ?? 'var(--linea-2)' }} aria-hidden="true" />
                      <span title={tituloTarea(f)}>{tituloTarea(f)}</span>
                    </span>
                  </td>
                  <td className="hoy-num">{f.min_efectivos ? duracion(f.min_efectivos) : '—'}</td>
                  <td className="hoy-num">
                    {desvio === null ? (
                      <span className="prod-nada">—</span>
                    ) : (
                      <span
                        className={desvio > 10 ? 'prod-baja' : desvio < -5 ? 'prod-sube' : 'prod-igual'}
                        title={desvio > 0 ? 'Tardó más que el estándar' : 'Tardó menos que el estándar'}
                      >
                        {desvio > 0 ? '+' : ''}
                        {desvio} %
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {filas.length > VISIBLES && <p className="hoy-mas">+{filas.length - VISIBLES} más en «Terminadas hoy»</p>}
    </section>
  )
}

function Ahora({ r, tanques }: { r: ResumenDia; tanques: EstadoTanque[] }) {
  const ahora = ahoraPlanta()
  const grupos = tanquesPorGrupo(tanques)
  return (
    <section className="hoy-panel" aria-labelledby="hoy-ahora-titulo">
      <header className="hoy-cabeza">
        <h3 id="hoy-ahora-titulo">Trabajando ahora</h3>
        <span className="hoy-contador">{r.trabajando.length}</span>
      </header>
      {r.trabajando.length === 0 ? (
        <p className="vacio hoy-vacio">Nadie anotado en una orden en este momento.</p>
      ) : (
        <ul className="hoy-operarias">
          {r.trabajando.map((t) => (
            <li key={t.empleadoId}>
              <span className={`hoy-avatar hoy-avatar-${t.entidad}`} aria-hidden="true">
                {t.nombre
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <span className="hoy-operaria">
                <b>{t.nombre}</b>
                <span>{t.tarea}</span>
              </span>
              <span className="hoy-desde" title={`Desde las ${horaMontevideo(Date.parse(t.desde))}`}>
                {duracion(Math.max(0, (ahora - Date.parse(t.desde)) / 60000))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tanques.length > 0 && (
        <div className="hoy-tanques">
          <h4>
            Tanques <span>{tanques.length}</span>
          </h4>
          <div className="hoy-tanques-barra" role="img" aria-label={GRUPOS_TANQUE.map((g) => `${grupos[g.id]} ${g.titulo.toLowerCase()}`).join(', ')}>
            {GRUPOS_TANQUE.filter((g) => grupos[g.id] > 0).map((g) => (
              <i key={g.id} className={`hoy-tq-${g.id}`} style={{ flexGrow: grupos[g.id] }} title={`${g.titulo}: ${grupos[g.id]}`} />
            ))}
          </div>
          <ul className="hoy-tanques-leyenda">
            {GRUPOS_TANQUE.map((g) => (
              <li key={g.id}>
                <i className={`hoy-tq-${g.id}`} aria-hidden="true" />
                {g.titulo} <b>{grupos[g.id]}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** Debajo del kanban: lo que pasó hoy y quién está trabajando. */
export function HoyEnPlanta({
  resumen,
  terminadas,
  tanques,
  proyeccion,
}: {
  resumen: ResumenDia
  terminadas: FilaFlujo[]
  tanques: EstadoTanque[]
  proyeccion: (f: FilaFlujo) => number | null
}) {
  return (
    <div className="hoy-planta" role="region" aria-label="Hoy en planta">
      <PorHora r={resumen} />
      <Terminadas filas={terminadas} proyeccion={proyeccion} />
      <Ahora r={resumen} tanques={tanques} />
    </div>
  )
}
