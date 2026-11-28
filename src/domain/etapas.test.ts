import { describe, expect, it } from 'vitest'
import { etapasDe } from './etapas'

describe('etapasDe', () => {
  it('fabricación en control: etapa 3 de 5', () => {
    expect(etapasDe('fabricacion', 'en_control')).toEqual({
      nombres: ['Cola', 'Fabricando', 'Control', 'Para envasar', 'Terminada'],
      actual: 2,
      pausada: false,
    })
  })

  it('marca la orden pausada (la luz de la etapa no corre)', () => {
    expect(etapasDe('fabricacion', 'pausada')?.pausada).toBe(true)
    expect(etapasDe('envasado', 'pausado')?.pausada).toBe(true)
    expect(etapasDe('envasado', 'activo')?.pausada).toBe(false)
  })

  it.each([
    ['cola', 0],
    ['fabricando', 1],
    ['para_envasar', 3],
    ['finalizada', 4],
  ])('fabricación %s → %i', (estado, actual) => {
    expect(etapasDe('fabricacion', estado)?.actual).toBe(actual)
  })

  it('pausado queda en la etapa donde se pausó', () => {
    expect(etapasDe('fabricacion', 'pausada')?.actual).toBe(1)
    expect(etapasDe('envasado', 'pausado')?.actual).toBe(1)
    expect(etapasDe('fraccionado', 'pausado')?.actual).toBe(1)
  })

  it('envasado y fraccionado: cola, en curso, terminado', () => {
    expect(etapasDe('envasado', 'activo')).toEqual({ nombres: ['Cola', 'Envasando', 'Terminado'], actual: 1, pausada: false })
    expect(etapasDe('fraccionado', 'finalizado')).toEqual({ nombres: ['Cola', 'Fraccionando', 'Terminado'], actual: 2, pausada: false })
    expect(etapasDe('envasado', 'cola')?.actual).toBe(0)
  })

  it('cancelado, estado desconocido o entidad desconocida: sin barra', () => {
    expect(etapasDe('envasado', 'cancelado')).toBeNull()
    expect(etapasDe('fabricacion', 'cancelada')).toBeNull()
    expect(etapasDe('fabricacion', 'raro')).toBeNull()
    expect(etapasDe('otra', 'cola')).toBeNull()
  })
})
