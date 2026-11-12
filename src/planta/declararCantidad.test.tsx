import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeclararCantidad } from './DeclararCantidad'

const personas = [
  { empleado_id: 'E1', nombre: 'Ana', desde: '2026-10-21T10:00:00Z' },
  { empleado_id: 'E2', nombre: 'Bea', desde: '2026-10-21T10:00:00Z' },
]

describe('DeclararCantidad', () => {
  it('confirma recién con todos los campos y manda la unidad elegida', () => {
    const onConfirmar = vi.fn()
    render(
      <DeclararCantidad
        personas={personas}
        unidadInicial="L"
        titulo="¿Cuánto envasaste?"
        onConfirmar={onConfirmar}
        onCancelar={() => {}}
      />,
    )
    const confirmar = screen.getByRole('button', { name: 'Confirmar' })
    expect(confirmar).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ana'), { target: { value: '12,5' } })
    expect(confirmar).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Bea'), { target: { value: '8' } })
    expect(confirmar).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'kg' }))
    expect(screen.getByRole('button', { name: 'kg' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(confirmar)
    expect(onConfirmar).toHaveBeenCalledWith([
      { empleadoId: 'E1', cantidad: 12.5, unidad: 'kg' },
      { empleadoId: 'E2', cantidad: 8, unidad: 'kg' },
    ])
  })

  it('cancelar avisa', () => {
    const onCancelar = vi.fn()
    render(
      <DeclararCantidad personas={personas.slice(0, 1)} unidadInicial="L" titulo="t" onConfirmar={() => {}} onCancelar={onCancelar} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancelar).toHaveBeenCalled()
  })

  it.each(['0', '-3'])('«%s» no habilita Confirmar', (valor) => {
    render(
      <DeclararCantidad personas={personas.slice(0, 1)} unidadInicial="L" titulo="t" onConfirmar={() => {}} onCancelar={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('Ana'), { target: { value: valor } })
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })
})
