import { expect, test } from 'vitest'
import { accionesPosibles } from './acciones'

test('fabricacion fabricando panel/planta puede pausar o finalizar', () => {
  expect(accionesPosibles('fabricacion', 'fabricando', 'planta')).toEqual(['pausar', 'finalizar'])
})

test('fabricacion cola panel puede iniciar o cancelar', () => {
  expect(accionesPosibles('fabricacion', 'cola', 'panel')).toEqual(['iniciar', 'cancelar'])
})

test('envasado pausado planta solo puede reanudar', () => {
  expect(accionesPosibles('envasado', 'pausado', 'planta')).toEqual(['reanudar'])
})

test('fraccionado finalizado panel no tiene acciones', () => {
  expect(accionesPosibles('fraccionado', 'finalizado', 'panel')).toEqual([])
})

test('estado desconocido devuelve array vacio', () => {
  expect(accionesPosibles('fabricacion', 'estado_inexistente', 'panel')).toEqual([])
})

test('rol planta nunca incluye cancelar', () => {
  expect(accionesPosibles('fabricacion', 'cola', 'planta')).not.toContain('cancelar')
  expect(accionesPosibles('envasado', 'activo', 'planta')).not.toContain('cancelar')
  expect(accionesPosibles('fraccionado', 'pausado', 'planta')).not.toContain('cancelar')
})

test('fabricacion cancelable desde cola, fabricando y pausada para panel', () => {
  expect(accionesPosibles('fabricacion', 'cola', 'panel')).toContain('cancelar')
  expect(accionesPosibles('fabricacion', 'fabricando', 'panel')).toContain('cancelar')
  expect(accionesPosibles('fabricacion', 'pausada', 'panel')).toContain('cancelar')
})

test('envasado activo panel puede pausar, finalizar y cancelar en ese orden', () => {
  expect(accionesPosibles('envasado', 'activo', 'panel')).toEqual(['pausar', 'finalizar', 'cancelar'])
})

test('fraccionado cola panel puede iniciar y cancelar', () => {
  expect(accionesPosibles('fraccionado', 'cola', 'panel')).toEqual(['iniciar', 'cancelar'])
})

test('fraccionado pausado panel puede reanudar y cancelar', () => {
  expect(accionesPosibles('fraccionado', 'pausado', 'panel')).toEqual(['reanudar', 'cancelar'])
})

test('fabricación para_envasar: solo el panel la cierra (merma)', () => {
  expect(accionesPosibles('fabricacion', 'para_envasar', 'panel')).toEqual(['finalizar'])
  expect(accionesPosibles('fabricacion', 'para_envasar', 'planta')).toEqual([])
})
