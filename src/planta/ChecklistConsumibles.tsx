import { useEffect, useRef, useState } from 'react'
import { guardarConsumible } from '../lib/acciones'
import { crearColaPorFila } from '../lib/colaPorFila'
import { cargarConsumiblesDe, type FilaConsumible } from '../lib/datosConsumibles'

type Fila = FilaConsumible & {
  // Lo escrito en el campo (puede diferir de lo guardado mientras se tipea o si falló).
  borrador: string
  // Último lote confirmado por la base.
  guardado: string
  error: string | null
  ok: boolean
}

export function ChecklistConsumibles({
  entidad,
  entidadId,
  empleadoId,
  habilitado,
  nombres = {},
  recarga = 0,
}: {
  entidad: 'envasado' | 'fraccionado'
  entidadId: string
  empleadoId: string
  habilitado: boolean
  // empleado_id → nombre, para mostrar quién cargó cada lote.
  nombres?: Record<string, string>
  // Al cambiar, vuelve a leer los consumibles (cambios de otra tablet o del panel).
  recarga?: number | string
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [errorCarga, setErrorCarga] = useState(false)
  // Por fila, número del último envío: solo ese muestra «Guardado» o el error.
  const envios = useRef<Record<string, number>>({})
  // Por fila, el último lote pedido: es lo que se manda cuando le toca el turno.
  const deseado = useRef<Record<string, string>>({})
  // Los guardados de una misma fila van de a uno y en orden.
  const [encolar] = useState(crearColaPorFila)
  // Ya se leyó la lista al menos una vez.
  const cargada = useRef(false)
  // Filas con el cursor adentro: una recarga no les pisa lo que se está escribiendo.
  const editando = useRef(new Set<string>())
  // Una respuesta que llega después de desmontar se descarta.
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  useEffect(() => {
    let vigente = true
    cargarConsumiblesDe(entidad, entidadId).then(
      (datos) => {
        if (!vigente) return
        cargada.current = true
        setFilas((previas) =>
          datos.map((f) => {
            const nueva: Fila = { ...f, borrador: f.lote ?? '', guardado: f.lote ?? '', error: null, ok: false }
            const previa = previas?.find((p) => p.id === f.id)
            if (!previa) return nueva
            // Con foco, borrador distinto de lo guardado o un guardado en camino: se conserva lo local.
            const enCamino = deseado.current[f.id] !== undefined && deseado.current[f.id] !== (f.lote ?? '')
            if (editando.current.has(f.id) || previa.borrador !== previa.guardado || enCamino) return previa
            delete deseado.current[f.id]
            return nueva
          }),
        )
      },
      // Una recarga fallida no tira la lista que ya funciona: el error es solo de la carga inicial.
      () => vigente && !cargada.current && setErrorCarga(true),
    )
    return () => {
      vigente = false
    }
  }, [entidad, entidadId, recarga])

  const cambiar = (id: string, cambio: Partial<Fila>) =>
    setFilas((fs) => fs && fs.map((f) => (f.id === id ? { ...f, ...cambio } : f)))

  const guardar = (id: string, lote: string) => {
    const n = (envios.current[id] ?? 0) + 1
    envios.current[id] = n
    deseado.current[id] = lote
    cambiar(id, { error: null, ok: false })
    void encolar(id, async () => {
      // Si ya hay otro pedido detrás, ese manda el valor más nuevo.
      if (envios.current[id] !== n) return
      const v = deseado.current[id] ?? lote
      const r = await guardarConsumible(id, v, empleadoId)
      if (!montado.current) return
      if (r.ok) cambiar(id, { guardado: v, cargado_por: v === '' ? null : empleadoId })
      if (envios.current[id] !== n) return
      // Ya no hay nada en camino para esta fila: una recarga puede traer el valor de la base.
      delete deseado.current[id]
      if (r.ok) return cambiar(id, { ok: true })
      cambiar(id, { error: r.texto })
    })
  }

  const salirDelLote = (f: Fila) => {
    const lote = f.borrador.trim()
    if (lote === (deseado.current[f.id] ?? f.guardado)) return
    guardar(f.id, lote)
  }

  if (errorCarga)
    return (
      <p className="mp-error" role="alert">
        No se pudieron cargar los consumibles. Salí y volvé a entrar.
      </p>
    )
  if (!filas) return <p className="mp-cargando">Cargando consumibles…</p>

  const conLote = filas.filter((f) => f.guardado.trim() !== '').length

  return (
    <section className="checklist-mp checklist-consumibles">
      <header className="mp-cabecera">
        <span className="mp-titulo">Consumibles (opcional)</span>
        <span className="mp-contador">
          {conLote} de {filas.length} con lote
        </span>
      </header>
      <ul className="mp-lista" aria-label="Consumibles">
        {filas.map((f) => {
          const lista = f.guardado.trim() !== ''
          return (
            <li key={f.id} className={`mp-fila${lista ? ' mp-completa' : ''}`}>
              <span className="mp-codigo">{f.codigo}</span>
              <span className="mp-descripcion">{f.descripcion}</span>
              <span className="mp-cantidad">{f.cantidad}</span>
              <input
                className="mp-lote"
                type="text"
                aria-label={`Lote de ${f.codigo}`}
                placeholder="Lote"
                autoComplete="off"
                value={f.borrador}
                disabled={!habilitado}
                onChange={(e) => cambiar(f.id, { borrador: e.target.value })}
                onFocus={() => editando.current.add(f.id)}
                onBlur={() => {
                  editando.current.delete(f.id)
                  salirDelLote(f)
                }}
              />
              <span className="mp-estado">
                {lista ? (
                  <span className="mp-marca" aria-label={`${f.codigo} con lote`}>
                    ✓
                  </span>
                ) : f.ok ? (
                  'Guardado'
                ) : null}
              </span>
              {lista && f.cargado_por && nombres[f.cargado_por] && (
                <span className="mp-autor">Cargó: {nombres[f.cargado_por]}</span>
              )}
              {f.error && (
                <p className="mp-error" role="alert">
                  {f.error}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
