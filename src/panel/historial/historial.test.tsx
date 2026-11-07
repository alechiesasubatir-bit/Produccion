import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filaH } from '../../test/fabricas'
import { Historial } from './Historial'

const m = vi.hoisted(() => ({ cargar: vi.fn(), descargar: vi.fn() }))

vi.mock('./datosHistorial', () => ({ cargarHistorial: m.cargar }))
vi.mock('../../domain/csv', async (original) => ({
  ...(await original<typeof import('../../domain/csv')>()),
  descargarCSV: m.descargar,
}))
vi.mock('../TablaMp', () => ({ TablaMp: (p: { fabricacionId: string }) => <p>{`mp de ${p.fabricacionId}`}</p> }))

const filas = [
  filaH({ producto: 'Lavandina', min_efectivos: 30, dia: '2026-10-15' }),
  filaH({ producto: 'Cloro', min_efectivos: 90, dia: '2026-10-15' }),
  filaH({ producto: 'Detergente', min_efectivos: 60, dia: '2026-10-20' }),
]

async function montar() {
  render(
    <MemoryRouter>
      <Historial />
    </MemoryRouter>,
  )
  await act(async () => {})
}

describe('Historial', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:00-03:00'))
    m.cargar.mockReset().mockResolvedValue(filas)
    m.descargar.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('arranca con "Este mes"', async () => {
    await montar()
    expect(m.cargar).toHaveBeenCalledWith({ desde: '2026-10-01', hasta: '2026-10-31' })
    expect(screen.getAllByRole('row')).toHaveLength(4) // encabezado + 3
  })

  it('ordenar por Efectivo alterna aria-sort', async () => {
    await montar()
    const th = screen.getByRole('columnheader', { name: /Efectivo/ })
    fireEvent.click(within(th).getByRole('button'))
    expect(th).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Lavandina')
    fireEvent.click(within(th).getByRole('button'))
    expect(th).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Cloro')
  })

  it('la búsqueda filtra', async () => {
    await montar()
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'clor' } })
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('exporta CSV con nombre y encabezados', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    const [nombre, contenido] = m.descargar.mock.calls[0]
    expect(nombre).toBe('prodcontrol-historial-2026-10-01_2026-10-31.csv')
    expect(contenido).toMatch(/^﻿Día;Tipo;Producto;/)
  })

  it('el botón Ver MP de una fabricación despliega la tabla de MP debajo de la fila y se puede ocultar', async () => {
    await montar()
    const filaFab = screen.getAllByRole('row')[1]
    fireEvent.click(within(filaFab).getByRole('button', { name: 'Ver MP' }))
    expect(screen.getByText(`mp de ${filas[0].id}`)).toBeInTheDocument()
    fireEvent.click(within(filaFab).getByRole('button', { name: 'Ocultar MP' }))
    expect(screen.queryByText(`mp de ${filas[0].id}`)).not.toBeInTheDocument()
  })

  it('en la vista Mes, elegir un día muestra la tabla de ese día', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Mes' }))
    await act(async () => {})
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^2026-10-15/ })))
    expect(m.cargar).toHaveBeenLastCalledWith({ desde: '2026-10-15', hasta: '2026-10-15' })
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
