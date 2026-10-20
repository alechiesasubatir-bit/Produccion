import { expect, test } from 'vitest'
import { burbujasTanque, nivelTanque, olaPausada } from './tanque'

test('nivelTanque libre es 0', () => {
  expect(nivelTanque({ estado: 'libre', capacidad: 2000 })).toBe(0)
})

test('nivelTanque fabricando usa litros x progresoFab / capacidad', () => {
  expect(
    nivelTanque({ estado: 'fabricando', capacidad: 2000, litros: 1000, progresoFab: 1 }),
  ).toBe(0.5)
})

test('nivelTanque envasando clampa a 1 cuando litrosRestantes excede capacidad', () => {
  expect(nivelTanque({ estado: 'envasando', capacidad: 2000, litrosRestantes: 3000 })).toBe(1)
})

test('nivelTanque envasando clampa a 0 cuando litrosRestantes es negativo', () => {
  expect(nivelTanque({ estado: 'envasando', capacidad: 2000, litrosRestantes: -5 })).toBe(0)
})

test('burbujasTanque devuelve 6 para fabricando, 2 para envasando y 0 para el resto', () => {
  expect(burbujasTanque('fabricando')).toBe(6)
  expect(burbujasTanque('envasando')).toBe(2)
  expect(burbujasTanque('pausada')).toBe(0)
})

test('olaPausada es true para env_pausado', () => {
  expect(olaPausada('env_pausado')).toBe(true)
})
