import { describe, expect, it } from 'vitest'
import { textoEventoOperaria, type EventoRecorrido } from './recorrido'

const ev = (over: Partial<EventoRecorrido>): EventoRecorrido => ({
  at: '2026-10-21T13:15:00Z',
  accion: 'iniciar',
  quien: 'Ana',
  entidad: 'fabricacion',
  ...over,
})

describe('textoEventoOperaria', () => {
  it('sumarse', () => expect(textoEventoOperaria(ev({ accion: 'sumarse' }))).toBe('Ana se sumó'))
  it('salir con y sin cantidad', () => {
    expect(textoEventoOperaria(ev({ accion: 'salir', quien: 'Marta', datos: { cantidad: 120, unidad: 'L' } }))).toBe('Marta salió (120 L)')
    expect(textoEventoOperaria(ev({ accion: 'salir', quien: 'Marta', datos: {} }))).toBe('Marta salió')
  })
  it('corregir', () => {
    const e = ev({ accion: 'corregir', usuario: 'Juana', sujeto: 'Marta', datos: { antes: 120, despues: 115, unidad: 'L' } })
    expect(textoEventoOperaria(e)).toBe('Juana corrigió a Marta: 120 → 115 L')
  })
  it('vencimiento desde la tablet o el panel, sin corrimiento de fecha', () => {
    const datos = { vencimiento: { antes: null, despues: '2027-05-12' } }
    expect(textoEventoOperaria(ev({ accion: 'editar', datos }))).toBe('Ana cambió el vencimiento a 12/05/2027')
    expect(textoEventoOperaria(ev({ accion: 'editar', quien: 'Encargada', datos }))).toBe('La encargada cambió el vencimiento a 12/05/2027')
    expect(textoEventoOperaria(ev({ accion: 'editar', quien: 'Encargada', usuario: 'Juana', datos }))).toBe('Juana cambió el vencimiento a 12/05/2027')
  })
  it('otros eventos quedan para el armado común', () => {
    expect(textoEventoOperaria(ev({ accion: 'editar', datos: {} }))).toBeNull()
    expect(textoEventoOperaria(ev({ accion: 'pausar' }))).toBeNull()
  })
})
