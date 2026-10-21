import { useEffect, useId, useRef, useState } from 'react'
import { mensajeError } from './errores'
import { supabase } from './supabase'

const DEBOUNCE_MS = 300
const POLLING_MS = 15_000

// Carga `cargar()` y la repite cuando cambia alguna tabla de `canales` (esquema produccion).
// Si el canal de Realtime no está SUBSCRIBED, cae a polling cada 15 s.
// `conectado` es la red (de eso dependen las acciones); `enVivo` es el canal de Realtime.
export function useRealtime<T>(
  tabla: string,
  cargar: () => Promise<T[]>,
  canales: string[],
): { datos: T[]; cargado: boolean; conectado: boolean; enVivo: boolean; error: string | null; recargar: () => void } {
  const [datos, setDatos] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargado, setCargado] = useState(false)
  const [canalOk, setCanalOk] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  const cargarRef = useRef(cargar)
  cargarRef.current = cargar
  // Varias cargas pueden estar en vuelo a la vez (inicial, eventos, polling): solo vale la última pedida.
  const ultimoPedido = useRef(0)
  const vigenteRef = useRef(true)

  const recargar = useRef(() => {
    const pedido = ++ultimoPedido.current
    cargarRef.current().then(
      (filas) => {
        if (!vigenteRef.current || pedido !== ultimoPedido.current) return
        setDatos(filas)
        setCargado(true)
        setError(null)
      },
      (e: unknown) => {
        if (vigenteRef.current && pedido === ultimoPedido.current) setError(mensajeError(e).texto)
      },
    )
  }).current

  const claveCanales = canales.join(',')
  // Sufijo por montaje: supabase.channel() reutiliza un canal con el mismo topic aunque se esté cerrando.
  const sufijo = useId()

  useEffect(() => {
    let vigente = true
    vigenteRef.current = true
    let espera: ReturnType<typeof setTimeout> | undefined

    const recargarPronto = () => {
      clearTimeout(espera)
      espera = setTimeout(recargar, DEBOUNCE_MS)
    }

    recargar()

    const canal = supabase.channel(`rt-${tabla}-${claveCanales}-${sufijo}`)
    for (const t of claveCanales.split(',').filter(Boolean)) {
      canal.on('postgres_changes', { event: '*', schema: 'produccion', table: t }, recargarPronto)
    }
    canal.subscribe((estado) => {
      if (!vigente) return
      const ok = estado === 'SUBSCRIBED'
      setCanalOk(ok)
      if (ok) recargarPronto() // al reconectar, ponerse al día
    })

    return () => {
      vigente = false
      vigenteRef.current = false
      clearTimeout(espera)
      void supabase.removeChannel(canal)
    }
  }, [tabla, claveCanales, sufijo, recargar])

  // Polling si el canal cayó, o siempre si no hay tablas que escuchar (p. ej. v_operarias).
  const sinCanales = claveCanales === ''
  useEffect(() => {
    if (canalOk && !sinCanales) return
    const id = setInterval(recargar, POLLING_MS)
    return () => clearInterval(id)
  }, [canalOk, sinCanales, recargar])

  useEffect(() => {
    const on = () => {
      setOnline(true)
      recargar() // ponerse al día al volver la red
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [recargar])

  return { datos, cargado, conectado: online, enVivo: canalOk, error, recargar }
}
