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

  // "Terminadas hoy" no ocupa columna: es una lengüeta a la derecha que se despliega.
  const [terminadasAbierta, setTerminadasAbierta] = useState(false)
  useEffect(() => {
    if (!terminadasAbierta) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setTerminadasAbierta(false)
    // tocar fuera de la lengüeta también la cierra
    const afuera = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.terminadas')) setTerminadasAbierta(false)
    }
    window.addEventListener('keydown', esc)
    document.addEventListener('pointerdown', afuera)
    return () => {
      window.removeEventListener('keydown', esc)
      document.removeEventListener('pointerdown', afuera)
    }
  }, [terminadasAbierta])
  const terminadas = grupos.terminadas

  const [aviso, setAviso] = useState<string | null>(null)
  const [nuevaAbierta, setNuevaAbierta] = useState(false)
  // "Cargar envasado" de una fabricación lista: Nueva orden → Envasado con ese tanque.
  const [envasarFab, setEnvasarFab] = useState<string | null>(null)
  const cerrarNueva = () => {
    setNuevaAbierta(false)
    setEnvasarFab(null)
  }

  const accionar = async (f: FilaFlujo, a: Accion) => {
    const r = await accionPanel({ entidad: f.entidad, id: f.id, accion: a })
    setAviso(r.ok ? null : r.texto)
    if (!r.ok) flujo.recargar()
  }

  const tarjeta = (f: FilaFlujo) => (
    <TarjetaFlujo
      key={`${f.entidad}-${f.id}`}
      fila={f}
      nombres={nombres}
      habilitado={flujo.conectado}
      cargadoEn={cargadoEn}
      proyeccionMin={proyeccion(f)}
      onAccion={(a) => void accionar(f, a)}
      onCargarEnvasado={() => setEnvasarFab(f.id)}
    />
  )

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
          {COLUMNAS.filter((c) => c.id !== 'terminadas').map((c) => (
            <section key={c.id} className={`kanban-col col-${c.id}`} aria-label={c.titulo}>
              <h2>
                {c.titulo} <span className="kanban-contador">{grupos[c.id].length}</span>
              </h2>
              <div className="kanban-lista">{grupos[c.id].map(tarjeta)}</div>
            </section>
          ))}
        </div>
        <div className={`terminadas${terminadasAbierta ? ' abierta' : ''}`}>
          <button
            type="button"
            className="terminadas-lengueta"
            aria-expanded={terminadasAbierta}
            aria-controls="terminadas-hoy"
            onClick={() => setTerminadasAbierta((v) => !v)}
          >
            <span className="terminadas-texto">Terminadas hoy</span>
            <span className="kanban-contador">{terminadas.length}</span>
          </button>
          <section
            id="terminadas-hoy"
            className="kanban-col col-terminadas terminadas-panel"
            aria-label="Terminadas hoy"
            inert={!terminadasAbierta}
          >
            <h2>
              Terminadas hoy <span className="kanban-contador">{terminadas.length}</span>
            </h2>
            <div className="kanban-lista">
              {terminadasAbierta && terminadas.map(tarjeta)}
              {terminadasAbierta && terminadas.length === 0 && <p className="vacio">Todavía no terminó nada hoy.</p>}
            </div>
          </section>
        </div>
      </LayoutGroup>
      <NuevaOrden
        abierta={nuevaAbierta || envasarFab !== null}
        tipoInicial={envasarFab ? 'envasado' : 'fabricacion'}
        fabricacionInicial={envasarFab ?? undefined}
        onCerrar={cerrarNueva}
        onCreada={() => {
          cerrarNueva()
          flujo.recargar()
        }}
      />
    </MotionConfig>
  )
}
