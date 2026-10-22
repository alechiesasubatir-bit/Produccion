import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvisoActualizacion, hayVersionNueva } from './AvisoActualizacion'

const publicada = (version: string) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version }) })))

const montar = (ruta = '/panel') =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <AvisoActualizacion version="v1" activo />
    </MemoryRouter>,
  )

describe('AvisoActualizacion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('compara la versión publicada con la que corre', async () => {
    publicada('v2')
    expect(await hayVersionNueva('v1', '/')).toBe(true)
    publicada('v1')
    expect(await hayVersionNueva('v1', '/')).toBe(false)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('sin red'))))
    expect(await hayVersionNueva('v1', '/')).toBe(false)
  })

  it('sin versión nueva no muestra nada', async () => {
    publicada('v1')
    montar()
    await act(async () => {})
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('con versión nueva avisa y ofrece actualizar', async () => {
    publicada('v2')
    montar()
    await act(async () => {})
    expect(screen.getByRole('status')).toHaveTextContent('Hay una actualización')
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument()
  })

  it('en el Monitor avisa que se actualiza sola', async () => {
    publicada('v2')
    montar('/panel/monitor')
    await act(async () => {})
    expect(screen.getByRole('status')).toHaveTextContent('se actualiza sola en 30 s')
  })
})
