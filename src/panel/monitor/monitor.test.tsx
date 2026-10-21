import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FilaFlujo } from '../../domain/flujo'
import type { EstadoTanqueFila } from '../../pages/ParedTanques'
import { Monitor } from './Monitor'

const m = vi.hoisted(() => ({ flujo: [] as unknown[], tanques: [] as unknown[] }))

vi.mock('../../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('../../lib/useRealtime', () => ({
  useRealtime: (tabla: string) => ({
    datos: tabla === 'v_flujo' ? m.flujo : tabla === 'v_tanque_estado' ? m.tanques : [{ empleado_id: 'E1', nombre: 'Laura Paz' }],
    cargado: true,
    conectado: true,
    enVivo: true,
    error: null,
    recargar: vi.fn(),
  }),
}))

let n = 0
function fila(over: Partial<FilaFlujo> = {}): FilaFlujo {
  n += 1
  return {
    entidad: 'fabricacion', id: `f${n}`, estado: 'fabricando', producto: 'Lavandina', color: '#facc15', tanque_codigo: 'T-01',
    presentacion: null, cantidad: null, litros: 900, lote: `L-${n}`, descripcion: null, operaria_1: 'E1', operaria_2: null,
    listo: true, inicio: '2026-10-21T12:00:00Z', min_efectivos: 12, corriendo: true, created_at: `2026-10-21T10:${String(n).padStart(2, '0')}:00Z`,
    fin: null, fabricacion_id: null, litros_restantes: 900, ...over,
  }
}

function tanque(over: Partial<EstadoTanqueFila>): EstadoTanqueFila {
  return {
    tanque_id: 't1', codigo: 'T-01', capacidad_l: 2000, orden: 1, estado: 'fabricando', fabricacion_id: 'f1', producto_id: 'p1',
    producto: 'Lavandina', color: '#facc15', litros: 900, litros_restantes: 900, envasado_id: null, operaria_id: null, inicio: null, ...over,
  }
}

const montar = () =>
  render(
    <MemoryRouter>
      <Monitor salir="/panel" />
    </MemoryRouter>,
  )

describe('Monitor (TV)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('muestra el flujo en sus 6 columnas, sin botones de acción', () => {
    m.flujo = [fila({}), fila({ estado: 'cola', corriendo: false, min_efectivos: null, inicio: null })]
    m.tanques = []
    montar()
    expect(screen.getAllByRole('region')).toHaveLength(6)
    const fabricando = screen.getByRole('region', { name: 'Fabricando' })
    expect(within(fabricando).getByRole('article', { name: 'Lavandina · 900 L' })).toBeInTheDocument()
    expect(within(fabricando).getByText('Laura Paz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pausar|Iniciar|Finalizar|Cancelar/ })).not.toBeInTheDocument()
  })

  it('con muchas tarjetas en una columna muestra las primeras y cuántas más hay', () => {
    m.flujo = Array.from({ length: 9 }, () => fila({ estado: 'cola', corriendo: false, inicio: null, min_efectivos: null }))
    montar()
    const cola = screen.getByRole('region', { name: 'Cola' })
    expect(within(cola).getAllByRole('article')).toHaveLength(6)
    expect(within(cola).getByText('+3 más')).toBeInTheDocument()
  })

  it('abajo, la tira de tanques con su nivel', () => {
    m.flujo = []
    m.tanques = [tanque({}), tanque({ tanque_id: 't2', codigo: 'T-02', estado: 'libre', producto: null, color: null, litros: null, litros_restantes: null })]
    montar()
    const tira = screen.getByRole('list', { name: 'Tanques' })
    expect(within(tira).getByText('T-01')).toBeInTheDocument()
    expect(within(tira).getByText('T-02')).toBeInTheDocument()
    expect(within(tira).getByText('Lavandina')).toBeInTheDocument()
    expect(within(tira).getByText('Libre')).toBeInTheDocument()
  })

  it('tiene los contadores, la hora y se puede salir o pasar a pantalla completa', async () => {
    m.flujo = [fila({})]
    const pantallaCompleta = vi.fn(() => Promise.resolve())
    document.documentElement.requestFullscreen = pantallaCompleta
    montar()
    expect(screen.getByText('fabricando')).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: 'Hora' })).toHaveTextContent(/^\d{2}:\d{2}$/)
    expect(screen.getByRole('link', { name: 'Salir del monitor' })).toHaveAttribute('href', '/panel')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pantalla completa' })))
    expect(pantallaCompleta).toHaveBeenCalled()
  })
})
