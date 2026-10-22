import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilaFlujo } from '../domain/flujo'
import { Flujo } from './Flujo'

const m = vi.hoisted(() => ({
  filas: [] as unknown[],
  accionPanel: vi.fn(),
  recargar: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('../lib/acciones', () => ({ accionPanel: m.accionPanel }))
vi.mock('../lib/useRealtime', () => ({
  useRealtime: (tabla: string) => ({
    datos: tabla === 'v_flujo' ? m.filas : [{ empleado_id: 'E1', nombre: 'Laura Paz' }],
    conectado: true,
    enVivo: true,
    error: null,
    recargar: m.recargar,
  }),
}))
vi.mock('./NuevaOrden', () => ({
  NuevaOrden: (p: { abierta: boolean; tipoInicial?: string; fabricacionInicial?: string }) =>
    p.abierta ? <p>{`nueva orden ${p.tipoInicial ?? 'fabricacion'} ${p.fabricacionInicial ?? ''}`.trim()}</p> : null,
}))
vi.mock('./historial/datosHistorial', () => ({
  cargarEstandares: () =>
    Promise.resolve([{ entidad: 'fabricacion', clave: 'Lavandina', velocidad: 10, muestras: 3, litros_hora_std: null }]),
}))

let n = 0
function fila(over: Partial<FilaFlujo> = {}): FilaFlujo {
  n += 1
  return {
    entidad: 'fabricacion',
    id: `f${n}`,
    estado: 'cola',
    producto: 'Lavandina',
    color: '#0284c7',
    tanque_codigo: 'T-01',
    presentacion: null,
    cantidad: null,
    litros: 1000,
    lote: null,
    descripcion: null,
    operaria_1: null,
    operaria_2: null,
    listo: true,
    inicio: null,
    min_efectivos: null,
    corriendo: false,
    created_at: `2026-10-21T10:${String(n).padStart(2, '0')}:00Z`,
    fin: null,
    fabricacion_id: null,
    litros_restantes: null,
    ...over,
  }
}

const columna = (titulo: string) => screen.getByRole('region', { name: titulo })

describe('Flujo', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('muestra las 5 columnas en orden y Terminadas hoy como lengüeta', () => {
    m.filas = []
    render(<Flujo />)
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .slice(0, 5)
        .map((h) => h.textContent?.replace(/\d+$/, '').trim()),
    ).toEqual(['Cola', 'Fabricando', 'Para envasar', 'Envasando', 'Fraccionado'])
    expect(screen.getByRole('button', { name: /Terminadas hoy/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('la lengüeta de Terminadas hoy se despliega con las terminadas', () => {
    m.filas = [fila({ id: 'listo', estado: 'finalizada', corriendo: false, fin: '2026-10-22T12:00:00Z' })]
    render(<Flujo />)
    expect(within(columna('Terminadas hoy')).queryAllByRole('article')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /Terminadas hoy/ }))
    expect(screen.getByRole('button', { name: /Terminadas hoy/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(columna('Terminadas hoy')).getAllByRole('article')).toHaveLength(1)
  })

  it('una tarea que cambia de estado aparece una sola vez, en su nueva columna', () => {
    const f = fila({ id: 'mover', estado: 'cola' })
    m.filas = [f]
    const { rerender } = render(<Flujo />)
    expect(within(columna('Cola')).getAllByRole('article')).toHaveLength(1)
    m.filas = [{ ...f, estado: 'fabricando', corriendo: true, operaria_1: 'E1' }]
    rerender(<Flujo />)
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(within(columna('Fabricando')).getByRole('article')).toHaveTextContent('Laura Paz')
  })

  it('KPIs con reduced motion muestran el valor final', () => {
    m.filas = [fila(), fila()]
    render(<Flujo />)
    expect(screen.getByText('en cola').previousElementSibling).toHaveTextContent('2')
  })

  it('cancelar pide confirmación', async () => {
    m.accionPanel.mockResolvedValue({ ok: true, fabricacionCerrada: false })
    m.filas = [fila({ id: 'c1' })]
    render(<Flujo />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(m.accionPanel).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '¿Seguro?' })))
    expect(m.accionPanel).toHaveBeenCalledWith({ entidad: 'fabricacion', id: 'c1', accion: 'cancelar' })
  })

  it('si la acción falla muestra el motivo y recarga', async () => {
    m.accionPanel.mockResolvedValue({ ok: false, codigo: 'TRANSICION_INVALIDA', texto: 'Esta tarea ya la inició Laura Paz a las 10:15.' })
    m.recargar.mockClear()
    m.filas = [fila()]
    render(<Flujo />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Iniciar' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Laura Paz a las 10:15')
    expect(m.recargar).toHaveBeenCalled()
  })

  it('barra de avance contra el tiempo estimado', async () => {
    m.filas = [fila({ estado: 'fabricando', corriendo: true, litros: 800, min_efectivos: 40, operaria_1: 'E1' })]
    render(<Flujo />)
    await act(async () => {})
    expect(screen.getByRole('progressbar', { name: /Avance estimado/ })).toHaveAttribute('aria-valuenow', '50')
  })

  it('la barra de avance avanza con el tiempo, sin recargar datos', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    m.filas = [fila({ estado: 'fabricando', corriendo: true, litros: 800, min_efectivos: 40, operaria_1: 'E1' })]
    render(<Flujo />)
    await act(async () => {})
    act(() => vi.advanceTimersByTime(20 * 60_000))
    expect(screen.getByRole('progressbar', { name: /Avance estimado/ })).toHaveAttribute('aria-valuenow', '75')
    vi.useRealTimers()
  })

  it('una fabricación en Para envasar ofrece Cargar envasado y Cerrar con merma (no "Finalizar")', async () => {
    m.accionPanel.mockResolvedValue({ ok: true, fabricacionCerrada: true })
    m.filas = [fila({ id: 'p1', estado: 'para_envasar' })]
    render(<Flujo />)
    const col = columna('Para envasar')
    expect(within(col).queryByRole('button', { name: 'Finalizar' })).not.toBeInTheDocument()
    await act(async () => fireEvent.click(within(col).getByRole('button', { name: 'Cargar envasado' })))
    expect(screen.getByText('nueva orden envasado p1')).toBeInTheDocument()
    fireEvent.click(within(col).getByRole('button', { name: 'Cerrar con merma' }))
    expect(m.accionPanel).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(within(col).getByRole('button', { name: '¿Cerrar sin envasar?' })))
    expect(m.accionPanel).toHaveBeenCalledWith({ entidad: 'fabricacion', id: 'p1', accion: 'finalizar' })
  })
})
