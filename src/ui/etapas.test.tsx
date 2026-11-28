import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Etapas } from './Etapas'

afterEach(cleanup)

test('marca hechas, la actual y las pendientes, y dice en qué etapa va', () => {
  const { container } = render(
    <Etapas etapas={{ nombres: ['Cola', 'Fabricando', 'Control', 'Para envasar', 'Terminada'], actual: 2, pausada: false }} />,
  )
  expect(screen.getByRole('img', { name: 'Etapa 3 de 5: Control' })).toBeInTheDocument()
  const segmentos = container.querySelectorAll('.etapas i')
  expect(segmentos).toHaveLength(5)
  expect(container.querySelectorAll('.etapas i.hecha')).toHaveLength(2)
  expect(container.querySelectorAll('.etapas i.actual')).toHaveLength(1)
  expect(segmentos[2].classList.contains('actual')).toBe(true)
  expect(segmentos[3].className).toBe('')
})

test('pausada: la barra lleva la clase que apaga la luz y lo dice', () => {
  const { container } = render(<Etapas etapas={{ nombres: ['Cola', 'Envasando', 'Terminado'], actual: 1, pausada: true }} />)
  expect(container.querySelector('.etapas')).toHaveClass('pausada')
  expect(screen.getByRole('img', { name: 'Etapa 2 de 3: Envasando (en pausa)' })).toBeInTheDocument()
})
