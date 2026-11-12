import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import { QuienTrabaja, type OperariaFila } from './QuienTrabaja'

const op = (empleado_id: string, nombre: string): OperariaFila => ({
  empleado_id,
  nombre,
  foto_url: null,
  categoria: 'A',
  color_avatar: '#db2777',
  activo: true,
})

const corriendo = { operarias: [], operaria_1: 'E1', operaria_2: null, corriendo: true, estado: 'fabricando' } as unknown as Tarea

describe('QuienTrabaja', () => {
  const operarias = [op('E2', 'Rosa Díaz'), op('E1', 'Laura Paz')]

  it('muestra las operarias en orden alfabético', () => {
    render(<QuienTrabaja operarias={operarias} tareas={[]} onElegir={() => {}} />)
    const nombres = screen.getAllByRole('button').map((b) => b.textContent)
    expect(nombres[0]).toContain('Laura Paz')
    expect(nombres[1]).toContain('Rosa Díaz')
  })

  it('al tocar una operaria la elige', () => {
    const onElegir = vi.fn()
    render(<QuienTrabaja operarias={operarias} tareas={[]} onElegir={onElegir} />)
    fireEvent.click(screen.getByRole('button', { name: /Rosa Díaz/ }))
    expect(onElegir).toHaveBeenCalledWith(operarias[0])
  })

  it('marca a quien está trabajando', () => {
    render(<QuienTrabaja operarias={operarias} tareas={[corriendo]} onElegir={() => {}} />)
    expect(screen.getByRole('button', { name: /Laura Paz/ }).querySelector('.punto-trabajando')).not.toBeNull()
  })
})
