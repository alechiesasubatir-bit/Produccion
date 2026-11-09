import { useEffect, useRef, useState } from 'react'
import { guardarMp } from '../lib/acciones'
import { crearColaPorFila } from '../lib/colaPorFila'
import { cargarMpDe, type FilaMp } from '../lib/datosMp'
import { mensajeError } from '../lib/errores'
import { db } from '../lib/supabase'

const hora = (at: string) =>
  new Date(at).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Montevideo' })
const numero = (n: number) => n.toLocaleString('es-AR', { useGrouping: false, maximumFractionDigits: 3 })

type Valor = { lote: string; pesado: boolean }
type Fila = FilaMp & { borrador: string; error: string | null; ok: boolean }

// Fabricación en curso: la encargada puede cargar lote y pesado desde el panel
// (p. ej. una orden sin operaria asignada que ninguna tablet ve).
const EDITABLE = new Set(['fabricando', 'pausada'])

// Checklist de materias primas de una fabricación: código, cantidad, lote, pesado, quién y cuándo.
const incompleta = (f: FilaMp) => !(f.lote ?? '').trim() || !f.pesado

// plegable (detalle de tanque): arranca plegada tras «Ver MP (N)» para que el panel entre en pantalla,
// salvo en curso con MP incompletas, que es cuando la encargada las tiene que cargar.
export function TablaMp({
  fabricacionId,
  estado,
  plegable = false,
}: {
  fabricacionId: string
  estado?: string | null
  plegable?: boolean
}) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [nombres, setNombres] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const editable = !!estado && EDITABLE.has(estado)
  const [abierta, setAbierta] = useState(!plegable)
  // Para decidir al cargar si arranca desplegada (sin volver a cargar cuando cambia el estado).
  const editableRef = useRef(editable)
  useEffect(() => {
    editableRef.current = editable
  })
  // Por fila: número del último pedido y el último lote+pesado pedido (lo que se manda en su turno).
  const envios = useRef<Record<string, number>>({})
  const deseado = useRef<Record<string, Valor>>({})
  const [encolar] = useState(crearColaPorFila)
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)
    Promise.all([cargarMpDe(fabricacionId), db.from('v_operarias').select('empleado_id, nombre')]).then(
      ([mp, operarias]) => {
        if (!vigente) return
        deseado.current = {}
        if (plegable) setAbierta(editableRef.current && mp.some(incompleta))
        setFilas(mp.map((f) => ({ ...f, borrador: f.lote ?? '', error: null, ok: false })))
        setNombres(new Map((operarias.data ?? []).map((o: { empleado_id: string; nombre: string }) => [o.empleado_id, o.nombre])))
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
  }, [fabricacionId, plegable])

  const cambiar = (id: string, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...cambio } : f)))

  const guardar = (id: string, valor: Valor) => {
    const n = (envios.current[id] ?? 0) + 1
    envios.current[id] = n
    deseado.current[id] = valor
    cambiar(id, { error: null, ok: false })
    void encolar(id, async () => {
      if (envios.current[id] !== n) return
      const v = deseado.current[id] ?? valor
      const r = await guardarMp({ id, lote: v.lote, pesado: v.pesado })
      if (!montado.current) return
      if (r.ok) cambiar(id, { lote: v.lote || null, cargado_at: new Date().toISOString() })
      if (envios.current[id] !== n) return
      cambiar(id, r.ok ? { ok: true } : { error: r.texto })
    })
  }

  const salirDelLote = (f: Fila) => {
    const lote = f.borrador.trim()
    if (lote === (deseado.current[f.id]?.lote ?? f.lote ?? '')) return
    guardar(f.id, { lote, pesado: f.pesado })
  }

  const tildar = (f: Fila, pesado: boolean) => {
    cambiar(f.id, { pesado })
    guardar(f.id, { lote: f.borrador.trim(), pesado })
  }

  if (cargando) return null
  const aviso = error && (
    <p className="aviso-panel" role="alert">
      {error}
    </p>
  )
  if (plegable && !aviso && filas.length === 0) return null
  if (plegable && aviso)
    return (
      <section className="detalle-seccion detalle-mp" aria-label="Materias primas">
        {aviso}
      </section>
    )
  if (aviso) return aviso
  if (filas.length === 0) return <p className="vacio">Sin materias primas (orden cargada a mano)</p>

  // En cola la base no deja cargar todavía: se avisa en vez de mostrar una tabla que parece rota.
  const pista = estado === 'cola' && (
    <p className="mp-pista">Lote y pesado se cargan cuando la fabricación está en curso: tocá «Iniciar».</p>
  )
  const tabla = (
    <div className="tabla-mp-caja">
      <table className={`tabla-mp${editable ? ' tabla-mp-editable' : ''}`}>
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Descripción</th>
            <th scope="col">Cantidad</th>
            <th scope="col">Lote</th>
            <th scope="col">Pesado</th>
            <th scope="col">Cargó</th>
            <th scope="col">Hora</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td>{f.codigo}</td>
              <td>{f.descripcion}</td>
              <td>{numero(f.cantidad)}</td>
              <td>
                {editable ? (
                  <input
                    className="mp-lote-panel"
                    type="text"
                    aria-label={`Lote de ${f.codigo}`}
                    placeholder="Lote"
                    autoComplete="off"
                    value={f.borrador}
                    onChange={(e) => cambiar(f.id, { borrador: e.target.value })}
                    onBlur={() => salirDelLote(f)}
                  />
                ) : (
                  (f.lote ?? '—')
                )}
              </td>
              <td>
                {editable ? (
                  <>
                    <input
                      type="checkbox"
                      aria-label={`Pesado ${f.codigo}`}
                      checked={f.pesado}
                      onChange={(e) => tildar(f, e.target.checked)}
                    />
                    {f.ok && <span className="mp-guardado">Guardado</span>}
                    {f.error && (
                      <span className="mp-error-panel" role="alert">
                        {f.error}
                      </span>
                    )}
                  </>
                ) : f.pesado ? (
                  '✓'
                ) : (
                  '—'
                )}
              </td>
              <td>{(f.cargado_por && nombres.get(f.cargado_por)) || '—'}</td>
              <td>{f.cargado_at ? hora(f.cargado_at) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  if (!plegable) return tabla
  return (
    <section className="detalle-seccion detalle-mp" aria-label="Materias primas">
      <button type="button" className="boton-mini" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
        {abierta ? 'Ocultar MP' : `Ver MP (${filas.length})`}
      </button>
      {abierta && pista}
      {abierta && tabla}
    </section>
  )
}
