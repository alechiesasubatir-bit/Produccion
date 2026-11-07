import { useEffect, useRef, useState } from 'react'
import { guardarMp } from '../lib/acciones'
import { crearColaPorFila } from '../lib/colaPorFila'
import { cargarMpDe, type FilaMp } from '../lib/datosMp'

type Guardado = { lote: string; pesado: boolean }

type Fila = FilaMp & {
  // Lo que está escrito en el campo (puede diferir de lo guardado mientras se tipea o si falló).
  borrador: string
  // Último valor confirmado por la base: es lo que cuenta para "completa".
  guardado: Guardado
  error: string | null
  ok: boolean
}

const completa = (g: Guardado) => g.lote.trim() !== '' && g.pesado

export function ChecklistMp({
  fabricacionId,
  empleadoId,
  pin,
  habilitado,
  recarga = 0,
  onCambio,
  onPinInvalido,
}: {
  fabricacionId: string
  empleadoId: string
  pin: string
  habilitado: boolean
  // Al cambiar, vuelve a leer las MP de la base (p. ej. si Finalizar dijo que faltan MP).
  recarga?: number
  onCambio: (completas: number) => void
  // PIN cambiado o bloqueado: quien la usa vuelve a pedirlo (igual que con accion()).
  onPinInvalido: (texto: string) => void
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [errorCarga, setErrorCarga] = useState(false)
  // Por fila, número del último envío: solo ese muestra «Guardado» o el error.
  const envios = useRef<Record<string, number>>({})
  // Por fila, el último lote+pesado pedido: es lo que se manda cuando le toca el turno.
  const deseado = useRef<Record<string, Guardado>>({})
  // Los guardados de una misma fila van de a uno y en orden (si no, la base puede quedar con el viejo).
  const [encolar] = useState(crearColaPorFila)
  const onCambioRef = useRef(onCambio)
  const onPinInvalidoRef = useRef(onPinInvalido)
  useEffect(() => {
    onCambioRef.current = onCambio
    onPinInvalidoRef.current = onPinInvalido
  })
  // Una respuesta que llega después de desmontar (otra persona, otra pantalla) se descarta.
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  useEffect(() => {
    let vigente = true
    cargarMpDe(fabricacionId).then(
      (datos) => {
        if (!vigente) return
        deseado.current = {}
        setFilas(
          datos.map((f) => ({
            ...f,
            borrador: f.lote ?? '',
            guardado: { lote: f.lote ?? '', pesado: f.pesado },
            error: null,
            ok: false,
          })),
        )
      },
      () => vigente && setErrorCarga(true),
    )
    return () => {
      vigente = false
    }
  }, [fabricacionId, recarga])

  const completas = filas ? filas.filter((f) => completa(f.guardado)).length : null
  useEffect(() => {
    if (completas !== null) onCambioRef.current(completas)
  }, [completas])

  const cambiar = (id: string, cambio: Partial<Fila>) =>
    setFilas((fs) => fs && fs.map((f) => (f.id === id ? { ...f, ...cambio } : f)))

  const guardar = (id: string, valor: Guardado) => {
    const n = (envios.current[id] ?? 0) + 1
    envios.current[id] = n
    deseado.current[id] = valor
    cambiar(id, { error: null, ok: false })
    void encolar(id, async () => {
      // Si ya hay otro pedido detrás, ese manda el valor más nuevo: este no hace falta.
      if (envios.current[id] !== n) return
      const v = deseado.current[id] ?? valor
      const r = await guardarMp({ id, lote: v.lote, pesado: v.pesado, empleadoId, pin })
      if (!montado.current) return
      // En orden: cada respuesta ok refleja lo que quedó en la base.
      if (r.ok) cambiar(id, { guardado: v })
      if (envios.current[id] !== n) return
      if (r.ok) return cambiar(id, { ok: true })
      cambiar(id, { error: r.texto })
      if (r.codigo === 'PIN_INCORRECTO' || r.codigo === 'PIN_BLOQUEADO') onPinInvalidoRef.current(r.texto)
    })
  }

  const salirDelLote = (f: Fila) => {
    const lote = f.borrador.trim()
    if (lote === (deseado.current[f.id] ?? f.guardado).lote) return
    guardar(f.id, { lote, pesado: f.pesado })
  }

  const tildar = (f: Fila, pesado: boolean) => {
    cambiar(f.id, { pesado })
    guardar(f.id, { lote: f.borrador.trim(), pesado })
  }

  if (errorCarga)
    return (
      <p className="mp-error" role="alert">
        No se pudieron cargar las materias primas. Salí y volvé a entrar.
      </p>
    )
  if (!filas || completas === null) return <p className="mp-cargando">Cargando materias primas…</p>

  return (
    <section className="checklist-mp">
      <header className="mp-cabecera">
        <span className="mp-titulo">Materias primas</span>
        <span className="mp-contador">
          {completas} de {filas.length} MP
        </span>
      </header>
      <ul className="mp-lista" aria-label="Materias primas">
        {filas.map((f) => {
          const lista = completa(f.guardado)
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
                onBlur={() => salirDelLote(f)}
              />
              <label className="mp-pesado">
                <input
                  type="checkbox"
                  aria-label={`Pesado ${f.codigo}`}
                  checked={f.pesado}
                  disabled={!habilitado}
                  onChange={(e) => tildar(f, e.target.checked)}
                />
                Pesado
              </label>
              <span className="mp-estado">
                {lista ? (
                  <span className="mp-marca" aria-label={`${f.codigo} completa`}>
                    ✓
                  </span>
                ) : f.ok ? (
                  'Guardado'
                ) : null}
              </span>
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
