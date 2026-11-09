import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import { PlantaApp } from './PlantaApp'

const m = vi.hoisted(() => ({
  ejecutarAccion: vi.fn(),
  guardarMp: vi.fn(),
  cargarMpDe: vi.fn(),
  recargar: vi.fn(),
  error: null as string | null,
  mpTotal: 0,
}))

vi.mock('../lib/acciones', () => ({
  ejecutarAccion: m.ejecutarAccion,
  guardarMp: m.guardarMp,
}))
vi.mock('../lib/datosMp', () => ({ cargarMpDe: m.cargarMpDe }))
vi.mock('../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('../auth/useSesion', () => ({ salir: vi.fn() }))

const operarias = [
  { empleado_id: 'E1', nombre: 'Laura Paz', foto_url: null, categoria: 'A', color_avatar: '#db2777', activo: true },
  { empleado_id: 'E2', nombre: 'Rosa Díaz', foto_url: null, categoria: 'A', color_avatar: '#0284c7', activo: true },
]
const suya: Tarea = {
  entidad: 'fabricacion',
  id: 'F1',
  estado: 'fabricando',
  producto: 'Lavandina',
  color: '#0284c7',
    producto_tipo: null,
  tanque_codigo: 'T-01',
  presentacion: null,
  cantidad: null,
  litros: 1200,
  lote: null,
  descripcion: null,
  operaria_1: 'E1',
  operaria_2: null,
  listo: true,
  inicio: '2026-10-21T10:00:00Z',
  min_efectivos: 5,
  corriendo: true,
  created_at: '2026-10-21T09:00:00Z',
  mp_total: 0,
  mp_completas: 0,
}

vi.mock('../lib/useRealtime', () => ({
  useRealtime: (tabla: string) => ({
    datos: tabla === 'v_operarias' ? operarias : [{ ...suya, mp_total: m.mpTotal }],
    conectado: true,
    enVivo: true,
    error: tabla === 'v_tareas' ? m.error : null,
    recargar: m.recargar,
  }),
}))

function montar() {
  return render(
    <MemoryRouter initialEntries={['/planta?tanque=T-03']}>
      <PlantaApp />
    </MemoryRouter>,
  )
}

// Sin PIN: tocar el nombre entra directo a las tareas.
async function entrarComoLaura() {
  fireEvent.click(screen.getByRole('button', { name: /Laura Paz/ }))
  await act(async () => {})
}

describe('PlantaApp', () => {
  afterEach(() => {
    vi.useRealTimers()
    m.mpTotal = 0
  })

  it('flujo feliz: persona → finalizar → confirmación, sin PIN', async () => {
    montar()
    await entrarComoLaura()
    expect(screen.getByText('Hola, Laura Paz')).toBeInTheDocument()
    m.ejecutarAccion.mockResolvedValue({ ok: true, fabricacionCerrada: false })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finalizar' })))
    expect(m.ejecutarAccion).toHaveBeenLastCalledWith({
      entidad: 'fabricacion',
      id: 'F1',
      accion: 'finalizar',
      empleadoId: 'E1',
    })
    expect(screen.getByText('Listo: finalizaste Lavandina · 1200 L')).toBeInTheDocument()
  })

  it('tocar el nombre entra directo a sus tareas', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Laura Paz/ }))
    expect(screen.getByText('Hola, Laura Paz')).toBeInTheDocument()
    expect(screen.queryByText('Ingresá tu PIN')).toBeNull()
  })

  it('acción rechazada: aviso, recarga y sin confirmación', async () => {
    montar()
    await entrarComoLaura()
    m.recargar.mockClear()
    m.ejecutarAccion.mockResolvedValue({
      ok: false,
      codigo: 'TRANSICION_INVALIDA',
      texto: 'Esta tarea ya la finalizó Rosa Díaz a las 10:15.',
    })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finalizar' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Esta tarea ya la finalizó Rosa Díaz a las 10:15.')
    expect(screen.queryByText(/^Listo:/)).toBeNull()
    expect(m.recargar).toHaveBeenCalled()
  })

  it('error al guardar una MP: se muestra en la fila y sigue en sus tareas', async () => {
    m.mpTotal = 1
    m.cargarMpDe.mockResolvedValue([
      { id: 'mp1', orden: 1, codigo: '900101', descripcion: 'Bacterias', cantidad: 6.5, lote: null, pesado: false, cargado_por: null, cargado_at: null },
    ])
    m.guardarMp.mockResolvedValue({ ok: false, codigo: 'NO_AUTORIZADO', texto: 'No tenés permiso para esta acción.' })
    montar()
    await entrarComoLaura()
    await act(async () => fireEvent.click(await screen.findByRole('checkbox', { name: 'Pesado 900101' })))
    expect(m.guardarMp).toHaveBeenCalledWith({ id: 'mp1', lote: '', pesado: true, empleadoId: 'E1' })
    expect(screen.getByText('Hola, Laura Paz')).toBeInTheDocument()
    expect(screen.getByText('No tenés permiso para esta acción.')).toBeInTheDocument()
  })

  it('Finalizar rechazado por MP incompletas: vuelve a leer el checklist de la base', async () => {
    m.mpTotal = 1
    const mp = { id: 'mp1', orden: 1, codigo: '900101', descripcion: 'Bacterias', cantidad: 6.5, cargado_por: null, cargado_at: null }
    m.cargarMpDe.mockReset().mockResolvedValueOnce([{ ...mp, lote: 'L1', pesado: true }]).mockResolvedValue([{ ...mp, lote: 'L1', pesado: false }])
    m.ejecutarAccion.mockResolvedValue({ ok: false, codigo: 'MP_INCOMPLETA', texto: 'Faltan 1 MP por completar.' })
    montar()
    await entrarComoLaura()
    expect(await screen.findByLabelText('900101 completa')).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finalizar' })))
    expect(m.cargarMpDe).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('checkbox', { name: 'Pesado 900101' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Finalizar/ })).toBeDisabled()
    m.mpTotal = 0
  })

  it('a los 30 s sin tocar vuelve a "¿Quién trabaja?"', async () => {
    vi.useFakeTimers()
    montar()
    await entrarComoLaura()
    expect(screen.getByText('Hola, Laura Paz')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(31_000))
    expect(screen.getByText('¿Quién trabaja?')).toBeInTheDocument()
    expect(screen.queryByText('Hola, Laura Paz')).toBeNull()
  })

  it('una acción que vuelve tarde no muestra confirmación en la sesión de otra', async () => {
    montar()
    await entrarComoLaura()
    let resolver!: (v: unknown) => void
    m.ejecutarAccion.mockReturnValue(new Promise((r) => (resolver = r)))
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar' }))
    fireEvent.click(screen.getByRole('button', { name: 'No soy yo' }))
    fireEvent.click(screen.getByRole('button', { name: /Rosa Díaz/ }))
    await act(async () => resolver({ ok: true, fabricacionCerrada: false }))
    expect(screen.queryByText(/^Listo:/)).toBeNull()
    expect(screen.getByText('Hola, Rosa Díaz')).toBeInTheDocument()
  })

  it('al volver al inicio recarga operarias y tareas', async () => {
    montar()
    await entrarComoLaura()
    m.recargar.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'No soy yo' }))
    expect(m.recargar).toHaveBeenCalledTimes(2)
  })

  it('si falla la carga de tareas se muestra el error', async () => {
    m.error = 'No tenés permiso para esta acción.'
    montar()
    await entrarComoLaura()
    expect(screen.getByRole('alert')).toHaveTextContent('No tenés permiso para esta acción.')
    m.error = null
  })
})
