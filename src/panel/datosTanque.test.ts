import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  tablas: {
    participaciones: [{ id: 'p1', empleado_id: 'E1', desde: 'd', hasta: 'h', cantidad: 1, unidad: 'L', cantidad_corregida: 2, corregida_por: 'U1', corregida_at: 'x' }],
    v_operarias: [{ empleado_id: 'E1', nombre: 'Laura' }],
  } as Record<string, unknown[]>,
}))

vi.mock('../lib/supabase', () => {
  const consulta = (t: string) => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.order = () => Promise.resolve({ data: m.tablas[t], error: null })
    q.then = (f: (r: unknown) => unknown) => Promise.resolve({ data: m.tablas[t], error: null }).then(f)
    return q
  }
  return { db: { from: consulta } }
})
vi.mock('./config/datosPersonas', () => ({ listarUsuarios: () => Promise.resolve([{ id: 'U1', nombre: 'Juana' }]) }))

import { cargarParticipaciones } from './datosTanque'

describe('cargarParticipaciones', () => {
  it('toma el nombre de quien corrigió de listar_usuarios', async () => {
    const [f] = await cargarParticipaciones('envasado', 'e1')
    expect(f.corregida_por_nombre).toBe('Juana')
    expect(f.nombre).toBe('Laura')
  })
})
