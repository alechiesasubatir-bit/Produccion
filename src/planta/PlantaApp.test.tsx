import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import { PlantaApp } from './PlantaApp'

const m = vi.hoisted(() => ({
  verificarPin: vi.fn(),
  ejecutarAccion: vi.fn(),
  recargar: vi.fn(),
}))

vi.mock('../lib/acciones', () => ({ verificarPin: m.verificarPin, ejecutarAccion: m.ejecutarAccion }))
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
}

vi.mock('../lib/useRealtime', () => ({
  useRealtime: (tabla: string) => ({
    datos: tabla === 'v_operarias' ? operarias : [suya],
    conectado: true,
    enVivo: true,
    error: null,
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

// Cada tecla es un evento propio (como en la tablet); después se espera la verificación.
async function teclear(pin: string) {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
  await act(async () => {})
}

async function entrarComoLaura(pinOk = true) {
  m.verificarPin.mockResolvedValue(pinOk ? { ok: true } : { ok: false, codigo: 'PIN_INCORRECTO', texto: 'PIN incorrecto. Probá de nuevo.' })
  fireEvent.click(screen.getByRole('button', { name: /Laura Paz/ }))
  await teclear('1234')
}

describe('PlantaApp', () => {
  afterEach(() => vi.useRealTimers())

  it('flujo feliz: persona → PIN → finalizar → confirmación', async () => {
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
      pin: '1234',
    })
    expect(screen.getByText('Listo: finalizaste Lavandina · 1200 L')).toBeInTheDocument()
  })

  it('PIN incorrecto: mensaje y sigue en el teclado', async () => {
    montar()
    await entrarComoLaura(false)
    expect(screen.getByRole('alert')).toHaveTextContent('PIN incorrecto. Probá de nuevo.')
    expect(screen.getByText('Ingresá tu PIN')).toBeInTheDocument()
  })

  it('PIN bloqueado', async () => {
    montar()
    m.verificarPin.mockResolvedValue({ ok: false, codigo: 'PIN_BLOQUEADO', texto: 'Demasiados intentos. Esperá un minuto.' })
    fireEvent.click(screen.getByRole('button', { name: /Laura Paz/ }))
    await teclear('1234')
    expect(screen.getByRole('alert')).toHaveTextContent('Demasiados intentos. Esperá un minuto.')
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

  it('a los 30 s sin tocar vuelve a "¿Quién trabaja?" y olvida el PIN', async () => {
    vi.useFakeTimers()
    montar()
    await entrarComoLaura()
    expect(screen.getByText('Hola, Laura Paz')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(31_000))
    expect(screen.getByText('¿Quién trabaja?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Laura Paz/ }))
    expect(screen.getByText('Ingresá tu PIN')).toBeInTheDocument()
  })
})
