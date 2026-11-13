import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { filaH } from '../../test/fabricas'
import { Calendario } from './Calendario'

describe('Calendario', () => {
  const rango = { desde: '2026-10-01', hasta: '2026-10-31' }
  it('el granel de stock no suma fabricaciones ni litros al día', () => {
    render(
      <Calendario
        modo="mes"
        rango={rango}
        onElegirDia={() => {}}
        filas={[filaH({ estado: 'finalizada', litros: 1000 }), filaH({ estado: 'para_envasar', origen: 'stock', litros: 700 })]}
      />,
    )
    expect(screen.getByText('1 fab.')).toBeTruthy()
    expect(screen.getByText(/^1[.,]?000 L$/)).toBeTruthy()
    expect(screen.queryByText(/1[.,]?700/)).toBeNull()
  })
})
