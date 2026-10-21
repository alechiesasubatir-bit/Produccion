import { describe, expect, it } from 'vitest'
import { rolDePerfil } from './rol'

describe('rolDePerfil', () => {
  it('admin de plataforma es panel aunque tenga rol de planta', () => {
    expect(rolDePerfil({ rol: 'admin', rol_produccion: 'planta', activo: true })).toBe('panel')
  })
  it('rol_produccion planta', () => {
    expect(rolDePerfil({ rol: 'sin_acceso', rol_produccion: 'planta', activo: true })).toBe('planta')
  })
  it('sin rol de producción', () => {
    expect(rolDePerfil({ rol: 'sin_acceso', rol_produccion: null, activo: true })).toBeNull()
  })
  it('perfil inactivo no tiene rol', () => {
    expect(rolDePerfil({ rol: 'admin', rol_produccion: 'panel', activo: false })).toBeNull()
  })
  it('sin perfil', () => {
    expect(rolDePerfil(null)).toBeNull()
  })
})
