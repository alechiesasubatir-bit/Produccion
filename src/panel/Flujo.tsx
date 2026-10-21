import { LayoutGroup, MotionConfig } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { Accion } from '../domain/acciones'
import { agruparFlujo, COLUMNAS, kpisFlujo, type FilaFlujo } from '../domain/flujo'
import type { Estandar } from '../domain/kpis'
import { proyeccionEnvasado, proyeccionFabricacion } from '../domain/proyecciones'
import { accionPanel } from '../lib/acciones'
import { useRealtime } from '../lib/useRealtime'
import { cargarFlujo, cargarOperarias } from './datosFlujo'
import { cargarEstandares } from './historial/datosHistorial'
import { KpisFlujo } from './KpisFlujo'
import { NuevaOrden } from './NuevaOrden'
import { TarjetaFlujo } from './TarjetaFlujo'

export function Flujo() {
  const flujo = useRealtime('v_flujo', cargarFlujo, ['fabricaciones', 'envasados', 'fraccionados'])
  const operarias = useRealtime('v_operarias', cargarOperarias, ['operarias'])
  const nombres = useMemo(() => new Map(operarias.datos.map((o) => [o.empleado_id, o.nombre])), [operarias.datos])
  const grupos = useMemo(() => agruparFlujo(flujo.datos), [flujo.datos])
  const kpis = useMemo(() => kpisFlujo(flujo.datos), [flujo.datos])
  const cargadoEn = useMemo(() => Date.now(), [flujo.datos])

  const [estandares, setEstandares] = useState<Estandar[]>([])
  useEffect(() => {
    cargarEstandares().then(setEstandares, () => setEstandares([]))
  }, [])
  const proyeccion = (f: FilaFlujo) =>
    f.entidad === 'fabricacion'
      ? proyeccionFabricacion(f.litros ?? 0, estandares.find((e) => e.entidad === 'fabricacion' && e.clave === f.producto))
      : f.entidad === 'envasado'
        ? proyeccionEnvasado(f.cantidad ?? 0, estandares.find((e) => e.entidad === 'envasado' && e.clave === f.presentacion))
        : null

  const [aviso, setAviso] = useState<string | null>(null)
  const [nuevaAbierta, setNuevaAbierta] = useState(false)

  const accionar = async (f: FilaFlujo, a: Accion) => {
    const r = await accionPanel({ entidad: f.entidad, id: f.id, accion: a })
    setAviso(r.ok ? null : r.texto)
    if (!r.ok) flujo.recargar()
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flujo-barra">
        <h1 className="titulo-panel">Flujo</h1>
        <KpisFlujo kpis={kpis} />
        <button type="button" className="boton" onClick={() => setNuevaAbierta(true)} disabled={!flujo.conectado}>
          + Nueva orden
        </button>
      </div>
      {(aviso ?? flujo.error) && (
        <p className="aviso-panel" role="alert">
          {aviso ?? flujo.error}
        </p>
      )}
      <LayoutGroup>
        <div className="kanban">
          {COLUMNAS.map((c) => (
            <section key={c.id} className={`kanban-col col-${c.id}`} aria-label={c.titulo}>
              <h2>
                {c.titulo} <span className="kanban-contador">{grupos[c.id].length}</span>
              </h2>
              <div className="kanban-lista">
                {grupos[c.id].map((f) => (
                  <TarjetaFlujo
                    key={`${f.entidad}-${f.id}`}
                    fila={f}
                    nombres={nombres}
                    habilitado={flujo.conectado}
                    cargadoEn={cargadoEn}
                    proyeccionMin={proyeccion(f)}
                    onAccion={(a) => void accionar(f, a)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </LayoutGroup>
      <NuevaOrden
        abierta={nuevaAbierta}
        onCerrar={() => setNuevaAbierta(false)}
        onCreada={() => {
          setNuevaAbierta(false)
          flujo.recargar()
        }}
      />
    </MotionConfig>
  )
}
