import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Tanque } from './Tanque'

afterEach(cleanup)

test('fabricando muestra 6 burbujas', () => {
  const { container } = render(<Tanque estado="fabricando" nivel={0.5} color="#0284c7" />)
  expect(container.querySelectorAll('.burbuja')).toHaveLength(6)
})

test('libre no tiene burbujas y el contorno es punteado', () => {
  const { container } = render(<Tanque estado="libre" nivel={0} />)
  expect(container.querySelectorAll('.burbuja')).toHaveLength(0)
  const contorno = container.querySelector('.vidrio')
  expect(contorno).not.toBeNull()
  expect(contorno).toHaveAttribute('stroke-dasharray')
})

test('nivel 0.5 traslada el líquido a translateY(60px)', () => {
  const { container } = render(<Tanque estado="envasando" nivel={0.5} color="#0284c7" />)
  const liquido = container.querySelector<SVGGElement>('.liquido')
  expect(liquido).not.toBeNull()
  expect(liquido!.style.transform).toContain('translateY(60px)')
})

test('pausada congela las olas', () => {
  const { container } = render(<Tanque estado="pausada" nivel={0.4} color="#0284c7" />)
  const olas = container.querySelectorAll<SVGPathElement>('.ola')
  expect(olas).toHaveLength(2)
  olas.forEach((ola) => expect(ola.style.animationPlayState).toBe('paused'))
})

test('color pinta las olas', () => {
  const { container } = render(<Tanque estado="fabricando" nivel={0.4} color="#db2777" />)
  const olas = container.querySelectorAll('.ola')
  expect(olas).toHaveLength(2)
  olas.forEach((ola) => expect(ola).toHaveAttribute('fill', '#db2777'))
})

test('dos tanques en la misma página tienen clipPath con ids distintos', () => {
  const { container } = render(
    <>
      <Tanque estado="fabricando" nivel={0.3} color="#0284c7" />
      <Tanque estado="envasando" nivel={0.6} color="#db2777" />
    </>,
  )
  const ids = Array.from(container.querySelectorAll('clipPath')).map((c) => c.id)
  expect(ids).toHaveLength(2)
  expect(ids[0]).toBeTruthy()
  expect(ids[0]).not.toBe(ids[1])
})

test('expone role img con aria-label y data-estado', () => {
  const { getByRole, rerender } = render(<Tanque estado="cola" nivel={0} />)
  const svg = getByRole('img', { name: 'Tanque cola' })
  expect(svg).toHaveAttribute('data-estado', 'cola')
  rerender(<Tanque estado="cola" nivel={0} etiqueta="T-01 en cola" />)
  expect(getByRole('img', { name: 'T-01 en cola' })).toBeInTheDocument()
})
