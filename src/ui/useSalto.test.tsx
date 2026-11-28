import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useSalto } from './useSalto'

function Tarjeta({ estado }: { estado: string }) {
  const ref = useSalto<HTMLElement>(estado)
  return <article ref={ref}>{estado}</article>
}

const animate = vi.fn()
let reducido = false

beforeEach(() => {
  animate.mockClear()
  reducido = false
  HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
  window.matchMedia = ((q: string) => ({ matches: reducido && q.includes('reduce') })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

test('no salta al montar', () => {
  render(<Tarjeta estado="cola" />)
  expect(animate).not.toHaveBeenCalled()
})

test('salta una vez cuando el estado cambia', () => {
  const { rerender } = render(<Tarjeta estado="cola" />)
  rerender(<Tarjeta estado="cola" />)
  expect(animate).not.toHaveBeenCalled()
  rerender(<Tarjeta estado="fabricando" />)
  expect(animate).toHaveBeenCalledTimes(1)
  expect(animate.mock.instances[0]).toBeInstanceOf(HTMLElement)
})

test('con movimiento reducido no salta', () => {
  reducido = true
  const { rerender } = render(<Tarjeta estado="cola" />)
  rerender(<Tarjeta estado="fabricando" />)
  expect(animate).not.toHaveBeenCalled()
})
