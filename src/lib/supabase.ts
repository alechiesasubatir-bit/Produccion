import { createClient } from '@supabase/supabase-js'
import { crearFetchDemo } from '../demo/fetchDemo'
import { motorDemo } from '../demo/motor'
import type { Database } from './database.types'
import { modoDemo } from './modoDemo'

export { fetchAll } from './fetchAll'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env')

// En la DEMO el cliente apunta a un host inexistente y todas sus requests las contesta el
// simulador (fetchDemo): no hay sesión ni red, y nada llega a la base real.
export const supabase = modoDemo
  ? createClient<Database>('https://demo.invalid', 'demo', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'prodcontrol_demo' },
      global: { fetch: crearFetchDemo(motorDemo().vivo, () => motorDemo().notificar()) },
    })
  : createClient<Database>(url, key, {
      auth: { persistSession: true, storageKey: 'prodcontrol_auth' },
    })

export const db = supabase.schema('produccion')
