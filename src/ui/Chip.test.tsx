import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Chip } from './Chip'

afterEach(cleanup)

test.each([
  ['fabricando', 'Fabricando', true],
  ['activo', 'Envasando', true],
  ['envasando', 'Envasando', true],
  ['fraccionado', 'Fraccionado', true],
  ['env_pausado', 'Pausado', false],
  ['cola_env', 'En cola', false],
  ['finalizado', 'Terminada', false],
  ['en_control', 'En control', false],
  ['libre', 'Libre', false],
])('chip %s dice "%s"', (estado, texto, enCurso) => {
  const { container } = render(<Chip estado={estado} />)
  expect(screen.getByText(texto)).toBeInTheDocument()
  const chip = container.querySelector('.chip')!
  expect(chip.classList.contains('en-curso')).toBe(enCurso)
})

test('no salta en la primera carga, aunque haya muchos chips', () => {
  const { container } = render(
    <>
      {Array.from({ length: 20 }, (_, i) => (
        <Chip key={i} estado={i % 2 ? 'fabricando' : 'activo'} />
      ))}
    </>,
  )
  expect(container.querySelectorAll('.chip')).toHaveLength(20)
  expect(container.querySelectorAll('.chip.salto')).toHaveLength(0)
})

test('salta cuando el estado cambia en vivo', () => {
  const { container, rerender } = render(<Chip estado="fabricando" />)
  expect(container.querySelector('.chip')!.classList.contains('salto')).toBe(false)
  rerender(<Chip estado="en_control" />)
  expect(screen.getByText('En control')).toBeInTheDocument()
  expect(container.querySelector('.chip')!.classList.contains('salto')).toBe(true)
})

test('estado desconocido muestra el texto humanizado', () => {
  render(<Chip estado="para_envasar" />)
  expect(screen.getByText('Para envasar')).toBeInTheDocument()
})

test('con clave salta aunque se vuelva a montar en otra columna', () => {
  const a = render(<Chip estado="cola" clave="fabricacion-chip-1" />)
  a.unmount()
  const { container } = render(<Chip estado="fabricando" clave="fabricacion-chip-1" />)
  expect(container.querySelector('.chip')!.classList.contains('salto')).toBe(true)
})
