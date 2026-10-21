import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BarraDemo } from './BarraDemo'

const m = vi.hoisted(() => ({ velocidad: 60, setVelocidad: vi.fn(), reiniciar: vi.fn() }))

vi.mock('./motor', () => ({
  VELOCIDADES: [0, 1, 10, 60, 300],
  motorDemo: () => ({
    velocidad: () => m.velocidad,
    setVelocidad: (v: number) => {
      m.velocidad = v
      m.setVelocidad(v)
    },
    reiniciar: m.reiniciar,
    ahora: () => Date.parse('2026-10-21T17:45:00Z'),
    suscribir: () => () => {},
  }),
}))

describe('BarraDemo', () => {
  it('avisa que son datos de prueba y muestra la hora simulada', () => {
    render(<BarraDemo />)
    expect(screen.getByText(/datos de prueba/i)).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: 'Hora simulada' })).toHaveTextContent('14:45')
  })

  it('cambia la velocidad y reinicia', async () => {
    render(<BarraDemo />)
    expect(screen.getByRole('button', { name: '60×' })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '300×' })))
    expect(m.setVelocidad).toHaveBeenCalledWith(300)
    expect(screen.getByRole('button', { name: '300×' })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pausa' })))
    expect(m.setVelocidad).toHaveBeenCalledWith(0)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' })))
    expect(m.reiniciar).toHaveBeenCalled()
  })
})
