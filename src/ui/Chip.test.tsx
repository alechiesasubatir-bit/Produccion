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
  ['libre', 'Libre', false],
])('chip %s dice "%s"', (estado, texto, enCurso) => {
  const { container } = render(<Chip estado={estado} />)
  expect(screen.getByText(texto)).toBeInTheDocument()
  const chip = container.querySelector('.chip')!
  expect(chip.classList.contains('en-curso')).toBe(enCurso)
})

test('estado desconocido muestra el texto humanizado', () => {
  render(<Chip estado="para_envasar" />)
  expect(screen.getByText('Para envasar')).toBeInTheDocument()
})
