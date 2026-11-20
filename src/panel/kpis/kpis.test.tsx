import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filaH } from '../../test/fabricas'
import { Kpis } from './Kpis'

const m = vi.hoisted(() => ({ descargar: vi.fn() }))

const env = (over = {}) =>
  filaH({ entidad: 'envasado', estado: 'finalizado', presentacion: '5L', litros_equiv: 5, cantidad: 100, litros: 500, ...over })

const tramo = (empleado_id: string, nombre: string, desde: string, cantidad: number, minutos: number) => ({
  empleado_id,
  nombre,
  desde,
  hasta: desde,
  cantidad,
  unidad: 'L' as const,
  cantidad_corregida: null,
  minutos,
})

vi.mock('../historial/datosHistorial', () => ({
  cargarHistorial: (r: { desde: string; hasta: string }) =>
    Promise.resolve([
      ...(r.desde === '2026-05-01'
        ? [
            filaH({ participaciones: [tramo('A', 'Ana', '2026-09-10T12:00:00Z', 600, 60), tramo('B', 'Bea', '2026-09-10T12:00:00Z', 600, 60)] }),
            filaH({ participaciones: [tramo('A', 'Ana', '2026-10-10T12:00:00Z', 900, 60), tramo('B', 'Bea', '2026-10-10T12:00:00Z', 300, 60)] }),
          ]
        : []),
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

  it('Productividad: 6 meses hasta el del rango, por operaria en la misma producción, con flecha y vs. equipo', async () => {
    await montar()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Productividad' })))
    const grupo = screen.getByRole('region', { name: 'Fabricación · Lavandina' })
    const cabeceras = within(grupo).getAllByRole('columnheader').map((c) => c.textContent)
    expect(cabeceras).toEqual(['Operaria', 'Tendencia', 'may 26', 'jun 26', 'jul 26', 'ago 26', 'sep 26', 'oct 26', 'vs. equipo'])
    const ana = within(grupo).getByRole('row', { name: /^Ana/ })
    expect(ana).toHaveTextContent('900')
    // +50 % contra septiembre y +50 % contra el equipo de octubre
    const subas = within(ana).getAllByText(/\+50 %/)
    expect(subas).toHaveLength(2)
    for (const e of subas) expect(e).toHaveClass('prod-sube')
    const bea = within(grupo).getByRole('row', { name: /^Bea/ })
    expect(within(bea).getAllByText(/-50 %/)[0]).toHaveClass('prod-baja')
    expect(within(grupo).getByRole('row', { name: /^Equipo/ })).toHaveTextContent('600')
    expect(within(ana).getByRole('img', { name: 'Tendencia de Ana: 600 → 900' })).toBeInTheDocument()

    // arriba: el resumen y cada operaria contra el equipo
    const resumen = screen.getByRole('group', { name: 'Resumen' })
    expect(resumen).toHaveTextContent('Horas medidas · oct 26')
    expect(resumen).toHaveTextContent('Más rápida que el equipo')
    expect(resumen).toHaveTextContent('Ana')
    const ranking = screen.getByRole('region', { name: 'Cada operaria contra el equipo · oct 26' })
    expect(within(ranking).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ana+50 %', 'Bea−50 %'])

    fireEvent.change(screen.getByLabelText('Buscar operaria o producto'), { target: { value: 'bea' } })
    expect(within(screen.getByRole('region', { name: 'Fabricación · Lavandina' })).queryByRole('row', { name: /^Ana/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    const [nombre, csv] = m.descargar.mock.calls.at(-1)!
    expect(nombre).toBe('prodcontrol-kpis-productividad-2026-10-01_2026-10-31.csv')
    expect(csv).toContain('Fabricación · Lavandina;L/h;Ana;;;;;600;900;600;50')
  })

  it('exporta la pestaña Productos', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Productos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    expect(m.descargar.mock.calls[0][0]).toBe('prodcontrol-kpis-productos-2026-10-01_2026-10-31.csv')
  })
})
