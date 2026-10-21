import type { User } from '@supabase/supabase-js'
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { rolDePerfil, type Rol } from './rol'

export type { Rol }
export type Sesion = { cargando: boolean; usuario: User | null; rol: Rol | null }

const Ctx = createContext<Sesion>({ cargando: true, usuario: null, rol: null })

export function SesionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null)
  const [authListo, setAuthListo] = useState(false)
  const [perfil, setPerfil] = useState<{ id: string; rol: Rol | null } | null>(null)

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
      .then(({ data }) => {
        if (vigente) setPerfil({ id: uid, rol: rolDePerfil(data) })
      })
    return () => {
      vigente = false
    }
  }, [uid])

  const perfilListo = !uid || perfil?.id === uid
  const valor: Sesion = {
    cargando: !authListo || !perfilListo,
    usuario,
    rol: uid && perfil?.id === uid ? perfil.rol : null,
  }
  return createElement(Ctx.Provider, { value: valor }, children)
}

export function useSesion(): Sesion {
  return useContext(Ctx)
}

export async function salir(): Promise<void> {
  await supabase.auth.signOut()
}
