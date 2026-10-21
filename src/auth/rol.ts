export type Rol = 'panel' | 'planta'

export type Perfil = { rol: string; rol_produccion: string | null; activo: boolean }

// Espejo de produccion.es_panel() / es_planta(). Panel tiene prioridad:
// un admin de plataforma siempre entra al panel.
export function rolDePerfil(p: Perfil | null): Rol | null {
  if (!p?.activo) return null
  if (p.rol === 'admin' || p.rol_produccion === 'panel') return 'panel'
  if (p.rol_produccion === 'planta') return 'planta'
  return null
}
