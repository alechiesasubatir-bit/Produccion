import { useEffect, useRef, useState } from 'react'
import { mensajeError } from './errores'
import { supabase } from './supabase'

const DEBOUNCE_MS = 300
const POLLING_MS = 15_000

// Carga `cargar()` y la repite cuando cambia alguna tabla de `canales` (esquema produccion).
// Si el canal de Realtime no está SUBSCRIBED, cae a polling cada 15 s.
export function useRealtime<T>(
  tabla: string,
  cargar: () => Promise<T[]>,
  canales: string[],
): { datos: T[]; conectado: boolean; error: string | null } {
  const [datos, setDatos] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)
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
        setError(null)
      },
      (e: unknown) => {
        if (vigenteRef.current && pedido === ultimoPedido.current) setError(mensajeError(e).texto)
      },
    )
  }).current

  const claveCanales = canales.join(',')

  useEffect(() => {
    let vigente = true
    vigenteRef.current = true
    let espera: ReturnType<typeof setTimeout> | undefined

    const recargarPronto = () => {
      clearTimeout(espera)
      espera = setTimeout(recargar, DEBOUNCE_MS)
    }

    recargar()

    const canal = supabase.channel(`rt-${tabla}-${claveCanales}`)
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
  }, [tabla, claveCanales, recargar])

  useEffect(() => {
    if (canalOk) return
    const id = setInterval(recargar, POLLING_MS)
    return () => clearInterval(id)
  }, [canalOk, recargar])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return { datos, conectado: online && canalOk, error }
}
