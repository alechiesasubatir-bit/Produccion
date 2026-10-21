import { useEffect, useState } from 'react'

// Estado de la red del navegador (de esto dependen los botones de escritura).
export function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setEnLinea(true)
    const off = () => setEnLinea(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return enLinea
}
