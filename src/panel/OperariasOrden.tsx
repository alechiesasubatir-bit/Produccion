import { useCallback, useEffect, useState } from 'react'
import type { Entidad } from '../domain/acciones'
import { cantidadEfectiva, esperadoEnvasado, totalDeclarado, type Unidad } from '../domain/participaciones'
import { parsearCantidad } from '../domain/tareas'
import { corregirCantidad } from '../lib/acciones'
import { mensajeError } from '../lib/errores'
import { horaMontevideo } from '../lib/hora'
import {
  cargarEsperadoEnvasado,
  cargarMpPorOperaria,
  cargarOperariasLegacy,
  cargarParticipaciones,
  type ParticipacionFila,
} from './datosTanque'

const hora = (iso: string) => horaMontevideo(new Date(iso).getTime())
const nf = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 2 })
const texto = (n: number, u: Unidad | null) => `${nf.format(n)} ${u ?? 'L'}`

function Edicion({ p, onListo, onCancelar }: { p: ParticipacionFila; onListo: () => void; onCancelar: () => void }) {
  const [valor, setValor] = useState('')
  const [unidad, setUnidad] = useState<Unidad>(p.unidad ?? 'L')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const cantidad = parsearCantidad(valor)

  const guardar = async () => {
    if (cantidad === null) return
    setGuardando(true)
    const r = await corregirCantidad({ participacionId: p.id, cantidad, unidad })
    setGuardando(false)
    if (r.ok) onListo()
    else setError(r.texto)
  }

  return (
    <span className="operarias-edicion">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Cantidad de ${p.nombre}`}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        autoFocus
      />
      <select aria-label="Unidad" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)}>
        <option value="L">L</option>
        <option value="kg">kg</option>
      </select>
      <button type="button" className="boton-mini principal" disabled={cantidad === null || guardando} onClick={() => void guardar()}>
        Guardar
      </button>
      <button type="button" className="boton-mini" onClick={onCancelar}>
        Cancelar
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  )
}

export function OperariasOrden({
  entidad,
  id,
  presentacionLitros,
  cantidad,
}: {
  entidad: Entidad
  id: string
  /** Litros de la presentación (solo envasado); junto con `cantidad` da el esperado. */
  presentacionLitros?: number
  cantidad?: number
}) {
  const [filas, setFilas] = useState<ParticipacionFila[] | null>(null)
  const [mp, setMp] = useState<Map<string, number>>(new Map())
  const [legacy, setLegacy] = useState<string[]>([])
  const [esperadoCargado, setEsperadoCargado] = useState<number | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const ps = await cargarParticipaciones(entidad, id)
      setFilas(ps)
      setLegacy(ps.length === 0 ? await cargarOperariasLegacy(entidad, id) : [])
      if (entidad === 'fabricacion' && ps.length > 0) setMp(await cargarMpPorOperaria(id))
      setAviso(null)
    } catch (e) {
      setAviso(mensajeError(e).texto)
    }
  }, [entidad, id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const esperadoDado = presentacionLitros != null && cantidad != null
  useEffect(() => {
    if (entidad !== 'envasado' || esperadoDado) return
    cargarEsperadoEnvasado(id).then(setEsperadoCargado, () => setEsperadoCargado(null))
  }, [entidad, id, esperadoDado])
  const esperado = esperadoDado ? esperadoEnvasado(cantidad, presentacionLitros) : esperadoCargado

  if (aviso)
    return (
      <p className="aviso-panel" role="alert">
        {aviso}
      </p>
    )
  if (!filas) return <p className="operarias-vacio">Cargando…</p>

  // Orden anterior a las participaciones: solo se conocen los nombres.
  if (filas.length === 0) {
    return legacy.length > 0 ? (
      <p className="operarias-legacy">{legacy.join(' · ')}</p>
    ) : (
      <p className="operarias-vacio">Sin operarias registradas.</p>
    )
  }

  const esFab = entidad === 'fabricacion'
  const tot = totalDeclarado(filas)
  const unidades = Object.entries(tot.porUnidad) as [Unidad, number][]
  const totalTxt = unidades.length ? unidades.map(([u, n]) => texto(n, u)).join(' + ') : texto(0, null)
  const desvio = esperado !== null && tot.faltan === 0 && unidades.length > 0 && Math.abs(tot.total - esperado) > 1e-9

  return (
    <div className="operarias-orden">
      <table className="operarias-tabla">
        <thead>
          <tr>
            <th>Operaria</th>
            <th>Desde</th>
            <th>Hasta</th>
            {esFab ? (
              <th>MP cargadas</th>
            ) : (
              <>
                <th>Declaró</th>
                <th>Corregido</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => {
            const cerrada = p.hasta !== null
            const corregida = p.cantidad_corregida !== null
            return (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{hora(p.desde)}</td>
                <td>{cerrada ? hora(p.hasta!) : 'sigue'}</td>
                {esFab ? (
                  <td>{mp.get(p.empleado_id) ?? 0}</td>
                ) : (
                  <>
                    <td>
                      {p.cantidad !== null ? (
                        corregida ? (
                          <s>{texto(p.cantidad, p.unidad)}</s>
                        ) : (
                          texto(p.cantidad, p.unidad)
                        )
                      ) : cerrada && !corregida ? (
                        <span className="operarias-falta">Falta declarar</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {editando === p.id ? (
                        <Edicion
                          p={p}
                          onCancelar={() => setEditando(null)}
                          onListo={() => {
                            setEditando(null)
                            void cargar()
                          }}
                        />
                      ) : (
                        <>
                          {corregida && (
                            <span>
                              {`${texto(p.cantidad_corregida!, p.unidad)} · corregido por ${p.corregida_por_nombre ?? 'Encargada'}${p.corregida_at ? ` ${hora(p.corregida_at)}` : ''}`}
                            </span>
                          )}{' '}
                          {cerrada && (
                            <button type="button" className="boton-mini" onClick={() => setEditando(p.id)}>
                              {cantidadEfectiva(p) === null ? 'Cargar' : 'Corregir'}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!esFab && (
        <p className={`operarias-total${desvio ? ' aviso' : ''}`}>
          <span>{`Total declarado: ${totalTxt}`}</span>
          {tot.faltan > 0 && <span>{` · Faltan declarar: ${tot.faltan}`}</span>}
          {entidad === 'envasado' && esperado !== null && <span>{` · Esperado: ${texto(esperado, 'L')}`}</span>}
        </p>
      )}
    </div>
  )
}
