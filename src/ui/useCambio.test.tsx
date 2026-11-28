import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { useCambio } from './useCambio'

test('vale 0 en el primer render y suma 1 por cada cambio posterior', () => {
  const { result, rerender } = renderHook(({ v }) => useCambio(v), { initialProps: { v: 'cola' } })
  expect(result.current).toBe(0)
  rerender({ v: 'cola' })
  expect(result.current).toBe(0)
  rerender({ v: 'fabricando' })
  expect(result.current).toBe(1)
  rerender({ v: 'fabricando' })
  expect(result.current).toBe(1)
  rerender({ v: 'en_control' })
  expect(result.current).toBe(2)
})

test('con clave recuerda el estado aunque el componente se vuelva a montar (cambio de columna)', () => {
  const a = renderHook(({ v }) => useCambio(v, 'fabricacion-77'), { initialProps: { v: 'cola' } })
  expect(a.result.current).toBe(0)
  a.unmount()
  // la orden pasó a otra columna: se monta de nuevo con otro estado → cuenta como cambio
  const b = renderHook(({ v }) => useCambio(v, 'fabricacion-77'), { initialProps: { v: 'fabricando' } })
  expect(b.result.current).toBe(1)
  b.unmount()
  // vuelve a montarse con el mismo estado (cambio de pestaña): no salta
  const c = renderHook(({ v }) => useCambio(v, 'fabricacion-77'), { initialProps: { v: 'fabricando' } })
  expect(c.result.current).toBe(0)
})

test('con una clave nunca vista no salta en la primera carga', () => {
  const { result } = renderHook(() => useCambio('cola', 'envasado-nueva'))
  expect(result.current).toBe(0)
})
