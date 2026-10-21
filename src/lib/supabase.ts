import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export { fetchAll } from './fetchAll'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env')

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, storageKey: 'prodcontrol_auth' },
})

export const db = supabase.schema('produccion')
