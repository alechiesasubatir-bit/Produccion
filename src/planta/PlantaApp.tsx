import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { salir as salirDispositivo } from '../auth/useSesion'
import type { Accion } from '../domain/acciones'
import { pasadoAccion, tituloTarea, type Tarea } from '../domain/tareas'
import { ejecutarAccion, verificarPin } from '../lib/acciones'
import { db, fetchAll } from '../lib/supabase'
import { useRealtime } from '../lib/useRealtime'
import { AnilloInactividad } from './AnilloInactividad'
import { Confirmacion } from './Confirmacion'
import { MisTareas } from './MisTareas'
import { QuienTrabaja, type OperariaFila } from './QuienTrabaja'
import { TecladoPin } from './TecladoPin'
import { useInactividad } from './useInactividad'
import './planta.css'

const INACTIVIDAD_MS = 30_000
const MANTENER_LOGO_MS = 2_000

const cargarOperarias = () =>
  fetchAll<OperariaFila>((from, to) => db.from('v_operarias').select('*').order('nombre').range(from, to))
const cargarTareas = () =>
  fetchAll<Tarea>((from, to) => db.from('v_tareas').select('*').order('created_at').range(from, to))

type Pantalla = 'quien' | 'pin' | 'tareas' | 'confirmacion'

function Reloj() {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return <span className="planta-reloj">{ahora.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</span>
}

export function PlantaApp() {
  const [params] = useSearchParams()
  const tanque = params.get('tanque')

  const operarias = useRealtime('v_operarias', cargarOperarias, [])
  const tareas = useRealtime('v_tareas', cargarTareas, ['fabricaciones', 'envasados', 'fraccionados'])
  // El cronómetro suma desde el momento en que llegaron los datos.
  const cargadoEn = useMemo(() => Date.now(), [tareas.datos])

  const [pantalla, setPantalla] = useState<Pantalla>('quien')
  const [operaria, setOperaria] = useState<OperariaFila | null>(null)
  // El PIN vive solo acá, en memoria, mientras la operaria está activa.
  const [pin, setPin] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [intentos, setIntentos] = useState(0)
  const [verificando, setVerificando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<{ color: string; texto: string } | null>(null)
  const enviando = useRef(false)

  const volverAlInicio = () => {
    setPantalla('quien')
    setOperaria(null)
    setPin(null)
    setPinError(null)
    setAviso(null)
    setConfirmacion(null)
  }

  const activa = pantalla === 'pin' || pantalla === 'tareas'
  const restante = useInactividad(activa, INACTIVIDAD_MS, volverAlInicio)

  const fallarPin = (texto: string) => {
    setPinError(texto)
    setIntentos((n) => n + 1)
  }

  const elegir = (o: OperariaFila) => {
    setOperaria(o)
    setPin(null)
    setPinError(null)
    setPantalla('pin')
  }

  const ingresarPin = async (p: string) => {
    if (!operaria) return
    setVerificando(true)
    const r = await verificarPin(operaria.empleado_id, p)
    setVerificando(false)
    if (!r.ok) return fallarPin(r.texto)
    setPin(p)
    setAviso(null)
    setPantalla('tareas')
  }

  const accionar = async (t: Tarea, a: Accion) => {
    if (!operaria || !pin || enviando.current) return
    enviando.current = true
    const r = await ejecutarAccion({ entidad: t.entidad, id: t.id, accion: a, empleadoId: operaria.empleado_id, pin })
    enviando.current = false
    if (r.ok) {
      setAviso(null)
      setConfirmacion({ color: t.color ?? '#0f172a', texto: `Listo: ${pasadoAccion(a)} ${tituloTarea(t)}` })
      setPantalla('confirmacion')
      return
    }
    tareas.recargar()
    if (r.codigo === 'PIN_INCORRECTO' || r.codigo === 'PIN_BLOQUEADO') {
      // La encargada le cambió el PIN o quedó bloqueada: volver a pedirlo.
      setPin(null)
      fallarPin(r.texto)
      setPantalla('pin')
      return
    }
    setAviso(r.texto)
  }

  const terminarConfirmacion = () => {
    setConfirmacion(null)
    setPantalla('tareas')
    tareas.recargar()
  }

  // Menú del dispositivo: mantener apretado el logo 2 s (las operarias no lo ven).
  const [menu, setMenu] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const soltarLogo = () => clearTimeout(temporizador.current)
  const apretarLogo = () => {
    soltarLogo()
    temporizador.current = setTimeout(() => setMenu(true), MANTENER_LOGO_MS)
  }

  return (
    <div className="planta">
      <header className="planta-barra">
        <span
          className="marca-nombre"
          onPointerDown={apretarLogo}
          onPointerUp={soltarLogo}
          onPointerLeave={soltarLogo}
        >
          ProdControl
        </span>
        <div className="planta-barra-der">
          {activa && <AnilloInactividad restante={restante} totalSeg={INACTIVIDAD_MS / 1000} />}
          <Reloj />
        </div>
      </header>
      {menu && (
        <div className="menu-dispositivo" role="dialog" aria-label="Menú del dispositivo">
          <button type="button" className="boton" onClick={() => void salirDispositivo()}>
            Cerrar sesión de la tablet
          </button>
          <button type="button" className="boton boton-sec" onClick={() => setMenu(false)}>
            Cancelar
          </button>
        </div>
      )}
      <main className="planta-cuerpo">
        {!operarias.conectado && pantalla !== 'tareas' && (
          <div className="banda-offline banda-planta" role="status">
            Sin conexión — no se pueden registrar acciones.
          </div>
        )}
        {pantalla === 'quien' && <QuienTrabaja operarias={operarias.datos} tareas={tareas.datos} onElegir={elegir} />}
        {pantalla === 'pin' && operaria && (
          <TecladoPin
            nombre={operaria.nombre}
            error={pinError}
            intento={intentos}
            ocupado={verificando || !operarias.conectado}
            onCompleto={(p) => void ingresarPin(p)}
            onVolver={volverAlInicio}
          />
        )}
        {pantalla === 'tareas' && operaria && (
          <MisTareas
            nombre={operaria.nombre}
            tareas={tareas.datos}
            empleadoId={operaria.empleado_id}
            tanque={tanque}
            conectado={tareas.conectado}
            cargadoEn={cargadoEn}
            aviso={aviso}
            onAccion={(t, a) => void accionar(t, a)}
            onSalir={volverAlInicio}
          />
        )}
        {pantalla === 'confirmacion' && confirmacion && (
          <Confirmacion color={confirmacion.color} texto={confirmacion.texto} onFin={terminarConfirmacion} />
        )}
      </main>
    </div>
  )
}
