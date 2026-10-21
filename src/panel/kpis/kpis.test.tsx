import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filaH } from '../../test/fabricas'
import { Kpis } from './Kpis'

const m = vi.hoisted(() => ({ descargar: vi.fn() }))

const env = (over = {}) =>
  filaH({ entidad: 'envasado', estado: 'finalizado', presentacion: '5L', litros_equiv: 5, cantidad: 100, litros: 500, ...over })

vi.mock('../historial/datosHistorial', () => ({
  cargarHistorial: () =>
    Promise.resolve([
      env({ operaria_1: 'E1', operaria_1_nombre: 'Laura Paz', cantidad: 50 }),
      env({ operaria_1: 'E2', operaria_1_nombre: 'Rosa Díaz', cantidad: 200 }),
      filaH({ producto: 'Lavandina', litros: 1000, min_efectivos: 103 }),
    ]),
  cargarEstandares: () =>
    Promise.resolve([{ entidad: 'fabricacion', clave: 'Lavandina', velocidad: 12, muestras: 3, litros_hora_std: 900 }]),
}))
vi.mock('../../domain/csv', async (original) => ({
  ...(await original<typeof import('../../domain/csv')>()),
  descargarCSV: m.descargar,
}))

async function montar() {
  render(<Kpis />)
  await act(async () => {})
}

describe('KPIs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:00-03:00'))
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ranking con medalla para la que más envasó', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ranking' }))
    const filas = screen.getAllByRole('row')
    expect(filas[1]).toHaveTextContent('🥇')
    expect(filas[1]).toHaveTextContent('Rosa Díaz')
  })

  it('tiempos vs. estándar marca en rojo un desvío alto', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Tiempos vs. estándar' }))
    const celda = within(screen.getByRole('row', { name: /Lavandina/ })).getByText('35 %')
    expect(celda).toHaveClass('desvio-alto')
  })

  it('exporta la pestaña Productos', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Productos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    expect(m.descargar.mock.calls[0][0]).toBe('prodcontrol-kpis-productos-2026-10-01_2026-10-31.csv')
  })
})
