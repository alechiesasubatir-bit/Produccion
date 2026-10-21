import type { User } from '@supabase/supabase-js'
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { rolDePerfil, type Rol } from './rol'

export type { Rol }
// errorPerfil: no se pudo leer el perfil (red/servidor). No es lo mismo que "sin rol".
export type Sesion = { cargando: boolean; usuario: User | null; rol: Rol | null; errorPerfil: boolean }

const REINTENTO_MS = 10_000

const Ctx = createContext<Sesion>({ cargando: true, usuario: null, rol: null, errorPerfil: false })

export function SesionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null)
  const [authListo, setAuthListo] = useState(false)
  const [perfil, setPerfil] = useState<{ id: string; rol: Rol | null; error: boolean } | null>(null)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUsuario(data.session?.user ?? null)
      setAuthListo(true)
    })
    // El callback no debe esperar llamadas a supabase (puede trabar el cliente de auth):
    // solo guarda el usuario; el perfil se busca en el efecto de abajo.
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => {
      setUsuario(s?.user ?? null)
      setAuthListo(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = usuario?.id
  useEffect(() => {
    if (!uid) return
    let vigente = true
    supabase
      .from('perfiles')
      .select('rol, rol_produccion, activo')
      .eq('id', uid)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (vigente) setPerfil({ id: uid, rol: error ? null : rolDePerfil(data), error: !!error })
        },
        () => {
          if (vigente) setPerfil({ id: uid, rol: null, error: true })
        },
      )
    return () => {
      vigente = false
    }
  }, [uid, intento])

  // Si la lectura falló, reintentar al volver la red y cada 10 s.
  const fallo = !!uid && perfil?.id === uid && perfil.error
  useEffect(() => {
    if (!fallo) return
    const reintentar = () => setIntento((n) => n + 1)
    window.addEventListener('online', reintentar)
    const id = setInterval(reintentar, REINTENTO_MS)
    return () => {
      window.removeEventListener('online', reintentar)
      clearInterval(id)
    }
  }, [fallo])

  const perfilListo = !uid || perfil?.id === uid
  const valor: Sesion = {
    cargando: !authListo || !perfilListo,
    usuario,
    rol: uid && perfil?.id === uid ? perfil.rol : null,
    errorPerfil: fallo,
  }
  return createElement(Ctx.Provider, { value: valor }, children)
}

export function useSesion(): Sesion {
  return useContext(Ctx)
}

export async function salir(): Promise<void> {
  await supabase.auth.signOut()
}
