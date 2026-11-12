import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clasificarTareas, type Tarea } from '../domain/tareas'
import { MisTareas } from './MisTareas'

const m = vi.hoisted(() => ({ registrarControl: vi.fn(), listarLiberadoras: vi.fn() }))
vi.mock('../lib/supabase', () => ({ db: {} }))
vi.mock('../lib/acciones', () => ({
  registrarControl: m.registrarControl,
  listarLiberadoras: m.listarLiberadoras,
  setVencimiento: vi.fn(),
  guardarMp: vi.fn(),
}))

let n = 0
function tarea(over: Partial<Tarea> = {}): Tarea {
  n += 1
  return {
    entidad: 'fabricacion',
    id: `t${n}`,
    estado: 'cola',
    producto: 'Lavandina',
    color: '#0284c7',
    producto_tipo: null,
    operarias: [],
    etiqueta: null,
    control_intento: null,
    control_rechazo: null,
    vencimiento: null,
    tanque_codigo: 'T-01',
    presentacion: null,
    cantidad: null,
    litros: 1000,
    lote: 'L-1',
    descripcion: null,
    operaria_1: null,
    operaria_2: null,
    listo: true,
    inicio: null,
    min_efectivos: null,
    corriendo: false,
    created_at: `2026-10-21T10:${String(n).padStart(2, '0')}:00Z`,
    mp_total: 0,
    mp_completas: 0,
    ...over,
  } as Tarea
}

function montar(tareas: Tarea[], onControlado = vi.fn()) {
  render(
    <MisTareas
      nombre="Laura Paz"
      tareas={tareas}
      empleadoId="E1"
      tanque={null}
      conectado
      cargadoEn={0}
      aviso={null}
      onAccion={vi.fn()}
      onControlado={onControlado}
      onSalir={vi.fn()}
    />,
  )
  return onControlado
}

const enControl = () => tarea({ estado: 'en_control', control_intento: 2, operaria_1: 'E1', operarias: [{ empleado_id: 'E1', nombre: 'Laura Paz', desde: '' }] })
const marcar = (grupo: string, op: 'OK' | 'No OK') =>
  fireEvent.click(within(screen.getByRole('group', { name: grupo })).getByRole('button', { name: op }))

describe('control para liberación en la tablet', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('en_control no es "en curso" ni mía: va solo al grupo En control', () => {
    const t = enControl()
    const c = clasificarTareas([t], 'E1')
    expect(c.enControl).toEqual([t])
    expect(c.mias).toEqual([])
    expect(clasificarTareas([t], 'E2').enCurso).toEqual([])
  })

  it('grupo «En control» debajo de «Mías», con Intento N y solo Controlar', () => {
    montar([enControl()])
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titulos.slice(0, 2)).toEqual(['Mías', 'En control'])
    const g = within(screen.getByRole('region', { name: 'En control' }))
    expect(g.getByText('Intento 2')).toBeInTheDocument()
    expect(g.getAllByRole('button').map((b) => b.textContent)).toEqual(['Controlar'])
  })

  it('flujo: ¿Quién controla? → formulario → registrarControl con firmante', async () => {
    m.listarLiberadoras.mockResolvedValue([{ id: 'L9', nombre: 'Marta Gil' }])
    m.registrarControl.mockResolvedValue({ ok: true, intento: 2 })
    const t = enControl()
    const onControlado = montar([t])
    fireEvent.click(screen.getByRole('button', { name: 'Controlar' }))
    expect(screen.getByText('¿Quién controla?')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Marta Gil' }))
    expect(screen.getByText(/Control — Intento 2/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '7,5' } })
    fireEvent.change(screen.getByLabelText('Densidad'), { target: { value: '1,02' } })
    marcar('Perfume', 'OK')
    marcar('Visual', 'OK')
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sí, aprobar' })))
    expect(m.registrarControl).toHaveBeenCalledWith(
      expect.objectContaining({ fabricacionId: t.id, ph: 7.5, densidad: 1.02, perfumeOk: true, visualOk: true, resultado: 'aprobado', firmante: 'L9' }),
    )
    await waitFor(() => expect(onControlado).toHaveBeenCalledWith(t, 'aprobado'))
    expect(screen.queryByText(/Control — Intento/)).toBeNull()
  })

  it('Volver cancela la elección de quién controla', async () => {
    m.listarLiberadoras.mockResolvedValue([{ id: 'L9', nombre: 'Marta Gil' }])
    montar([enControl()])
    fireEvent.click(screen.getByRole('button', { name: 'Controlar' }))
    await screen.findByRole('button', { name: 'Marta Gil' })
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(screen.queryByText('¿Quién controla?')).toBeNull()
  })

  it('si no carga la lista muestra el error', async () => {
    m.listarLiberadoras.mockRejectedValue(new Error('x'))
    montar([enControl()])
    fireEvent.click(screen.getByRole('button', { name: 'Controlar' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('fabricación rechazada muestra el motivo en «En curso — sumarme» y se puede sumar', () => {
    const t = tarea({ estado: 'fabricando', operaria_1: 'E2', operarias: [{ empleado_id: 'E2', nombre: 'Rosa Díaz', desde: '' }], control_rechazo: 'pH alto', corriendo: true })
    montar([t])
    const g = within(screen.getByRole('region', { name: 'En curso para sumarme' }))
    expect(g.getByText('Rechazado: pH alto')).toBeInTheDocument()
    expect(g.getByRole('button', { name: 'Sumarme' })).toBeInTheDocument()
  })
})
