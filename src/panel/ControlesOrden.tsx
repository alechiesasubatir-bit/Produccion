import { useCallback, useEffect, useState } from 'react'
import type { ControlHistorial } from '../domain/control'
import { mensajeError } from '../lib/errores'
import { horaMontevideo } from '../lib/hora'
import { useCambios } from '../lib/useRealtime'
import { cargarControles } from './datosTanque'

const hora = (iso: string) => horaMontevideo(new Date(iso).getTime())
const nf = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 3 })
const punto = (ok: boolean, comentario: string | null) => (ok ? 'OK' : `No OK: ${comentario ?? ''}`)

// Cada intento de control de una fabricación, con lo medido y quién lo firmó.
export function ControlesOrden({ fabricacionId }: { fabricacionId: string }) {
  const [filas, setFilas] = useState<ControlHistorial[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(
    async (vigente: () => boolean = () => true) => {
      try {
        const cs = await cargarControles(fabricacionId)
        if (!vigente()) return
        setFilas(cs)
        setAviso(null)
      } catch (e) {
        if (vigente()) setAviso(mensajeError(e).texto)
      }
    },
    [fabricacionId],
  )

  useEffect(() => {
    let vigente = true
    void cargar(() => vigente)
    return () => {
      vigente = false
    }
  }, [cargar])

  useCambios(['controles'], () => void cargar())

  if (aviso)
    return (
      <p className="aviso-panel" role="alert">
        {aviso}
      </p>
    )
  if (!filas) return <p className="operarias-vacio">Cargando…</p>
  if (filas.length === 0) return <p className="operarias-vacio">Sin controles todavía.</p>

  return (
    <ol className="controles-orden">
      {filas.map((c) => (
        <li key={c.intento} className="control-intento">
          <p className="control-cabecera">
            <strong>{`Intento ${c.intento}`}</strong>
            <span className={`control-resultado ${c.resultado}`}>{c.resultado === 'aprobado' ? 'Aprobado' : 'Rechazado'}</span>
          </p>
          <p className="control-valores">
            {c.ph !== null && <span>{`pH ${nf.format(c.ph)}`}</span>}
            {c.densidad !== null && <span>{`Densidad ${nf.format(c.densidad)}`}</span>}
            <span>{`Perfume ${punto(c.perfume_ok, c.perfume_comentario)}`}</span>
            <span>{`Visual ${punto(c.visual_ok, c.visual_comentario)}`}</span>
          </p>
          {c.observaciones && <p className="control-obs">{`Observaciones: ${c.observaciones}`}</p>}
          <p className="control-firma">{`${c.firmado_nombre ?? 'Encargada'} · ${hora(c.created_at)} · ${c.origen}`}</p>
        </li>
      ))}
    </ol>
  )
}
