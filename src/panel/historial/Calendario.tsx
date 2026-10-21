import { diasDelMes, porDia, type FilaHistorial, type Rango } from '../../domain/historial'
import { terminada } from '../../domain/kpis'
import { tituloTarea } from '../../domain/tareas'
import { Chip } from '../../ui/Chip'

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function resumen(filas: FilaHistorial[]) {
  const c = { fabricacion: 0, envasado: 0, fraccionado: 0, litros: 0 }
  for (const f of filas) {
    c[f.entidad] += 1
    if (f.entidad === 'fabricacion' && terminada(f)) c.litros += f.litros ?? 0
  }
  return c
}

export function tituloRango(modo: 'mes' | 'semana', r: Rango): string {
  const [a, m] = r.desde.split('-').map(Number)
  if (modo === 'mes') return `${MESES[m - 1]} ${a}`
  const f = (s: string) => `${Number(s.slice(8))}/${Number(s.slice(5, 7))}`
  return `Semana del ${f(r.desde)} al ${f(r.hasta)}`
}

export function Calendario({
  modo,
  rango,
  filas,
  onElegirDia,
}: {
  modo: 'mes' | 'semana'
  rango: Rango
  filas: FilaHistorial[]
  onElegirDia: (dia: string) => void
}) {
  const grupos = porDia(filas)
  const [anio, mes] = rango.desde.split('-').map(Number)
  const dias =
    modo === 'mes'
      ? diasDelMes(anio, mes)
      : Array.from({ length: 7 }, (_, i) => {
          const d = new Date(`${rango.desde}T00:00:00Z`)
          d.setUTCDate(d.getUTCDate() + i)
          return d.toISOString().slice(0, 10)
        })

  return (
    <div className={`calendario calendario-${modo}`}>
      {DIAS_SEMANA.map((d) => (
        <div key={d} className="cal-encabezado" aria-hidden="true">
          {d}
        </div>
      ))}
      {dias.map((dia) => {
        const lista = grupos.get(dia) ?? []
        const c = resumen(lista)
        const fuera = modo === 'mes' && Number(dia.slice(5, 7)) !== mes
        return (
          <button
            key={dia}
            type="button"
            className={`cal-dia${fuera ? ' fuera' : ''}${lista.length ? ' con-tareas' : ''}`}
            aria-label={`${dia}: ${lista.length} tareas`}
            onClick={() => onElegirDia(dia)}
          >
            <span className="cal-numero">{Number(dia.slice(8))}</span>
            {modo === 'mes' ? (
              lista.length > 0 && (
                <span className="cal-resumen">
                  {c.fabricacion > 0 && <span className="cal-tipo fab">{c.fabricacion} fab.</span>}
                  {c.envasado > 0 && <span className="cal-tipo env">{c.envasado} env.</span>}
                  {c.fraccionado > 0 && <span className="cal-tipo frac">{c.fraccionado} frac.</span>}
                  {c.litros > 0 && <span className="cal-litros">{c.litros.toLocaleString('es-UY')} L</span>}
                </span>
              )
            ) : (
              <span className="cal-lista">
                {lista.map((f) => (
                  <span key={f.id} className="cal-tarea">
                    <Chip estado={f.estado} /> {tituloTarea(f)}
                  </span>
                ))}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
