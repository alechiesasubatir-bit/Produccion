import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PulsoVivo } from './PulsoVivo'

let enLinea = true
beforeEach(() => {
  enLinea = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => enLinea)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function cortar() {
  enLinea = false
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

test('con conexión dice «En vivo»', () => {
  const { container } = render(<PulsoVivo />)
  const pulso = container.querySelector('.pulso-vivo')!
  expect(pulso).toHaveTextContent('En vivo')
  expect(pulso).not.toHaveClass('apagado')
})

test('sin conexión se apaga y lo dice', () => {
  const { container } = render(<PulsoVivo />)
  cortar()
  const pulso = container.querySelector('.pulso-vivo')!
  expect(pulso).toHaveTextContent('Desconectado')
  expect(pulso).toHaveClass('apagado')
})

test('en la demo siempre está en vivo', () => {
  const { container } = render(<PulsoVivo forzarVivo />)
  cortar()
  expect(container.querySelector('.pulso-vivo')).toHaveTextContent('En vivo')
})
