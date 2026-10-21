import { describe, expect, it } from 'vitest'
import { mensajeError } from './errores'
import { fetchAll } from './fetchAll'

describe('mensajeError', () => {
  it('PIN incorrecto', () => {
    expect(mensajeError({ message: 'PIN_INCORRECTO' })).toEqual({
      codigo: 'PIN_INCORRECTO',
      texto: 'PIN incorrecto. Probá de nuevo.',
    })
  })

  it('PIN bloqueado', () => {
    expect(mensajeError({ message: 'PIN_BLOQUEADO' }).texto).toBe('Demasiados intentos. Esperá un minuto.')
  })

  it('transición inválida usa el detalle', () => {
    expect(mensajeError({ message: 'TRANSICION_INVALIDA', details: 'ya la finalizó Laura Paz a las 14:02' }).texto).toBe(
      'Esta tarea ya la finalizó Laura Paz a las 14:02.',
    )
  })

  it('operaria ocupada usa el detalle', () => {
    expect(mensajeError({ message: 'OPERARIA_OCUPADA', details: 'Lavandina 5L' }).texto).toBe('Ya estás envasando Lavandina 5L.')
  })

  it('respuesta {ok:false} de accion()', () => {
    expect(mensajeError({ ok: false, codigo: 'OPERARIA_OCUPADA', detalle: 'Lavandina 5L' })).toEqual({
      codigo: 'OPERARIA_OCUPADA',
      texto: 'Ya estás envasando Lavandina 5L.',
    })
  })

  it('tanque con orden abierta (constraint única)', () => {
    expect(
      mensajeError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "fabricaciones_tanque_abierta_uk"',
      }),
    ).toEqual({ codigo: 'TANQUE_OCUPADO', texto: 'Ese tanque ya tiene una orden abierta.' })
  })

  it('operaria duplicada', () => {
    expect(
      mensajeError({ code: '23505', message: 'duplicate key value violates unique constraint "operarias_pkey"' }).texto,
    ).toBe('Esa persona ya es operaria.')
  })

  it('no se puede cambiar el propio rol', () => {
    expect(mensajeError({ code: '42501', message: 'NO_PROPIO_ROL', details: 'No podés cambiar tu propio rol.' })).toEqual({
      codigo: 'NO_PROPIO_ROL',
      texto: 'No podés cambiar tu propio rol.',
    })
  })

  it('PIN inválido', () => {
    expect(mensajeError({ code: '22023', message: 'PIN_INVALIDO' }).texto).toBe('El PIN son 4 dígitos.')
  })

  it('sin red', () => {
    expect(mensajeError(new TypeError('Failed to fetch'))).toEqual({
      codigo: 'RED',
      texto: 'Sin conexión. Revisá el WiFi.',
    })
  })

  it('cualquier otro error', () => {
    expect(mensajeError(new Error('boom'))).toEqual({
      codigo: 'DESCONOCIDO',
      texto: 'Algo salió mal. Avisá a la encargada.',
    })
  })
})

describe('fetchAll', () => {
  it('pagina hasta recibir una página incompleta', async () => {
    const tamaños = [1000, 1000, 3]
    const llamadas: Array<[number, number]> = []
    const filas = await fetchAll<number>(async (from, to) => {
      llamadas.push([from, to])
      const n = tamaños[llamadas.length - 1]
      return { data: Array.from({ length: n }, (_, i) => from + i), error: null }
    })
    expect(filas).toHaveLength(2003)
    expect(llamadas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })
})
