import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import { QuienTrabaja, type OperariaFila } from './QuienTrabaja'
import { TecladoPin } from './TecladoPin'

const op = (empleado_id: string, nombre: string): OperariaFila => ({
  empleado_id,
  nombre,
  foto_url: null,
  categoria: 'A',
  color_avatar: '#db2777',
  activo: true,
})

const corriendo = { operaria_1: 'E1', operaria_2: null, corriendo: true, estado: 'fabricando' } as Tarea

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

describe('TecladoPin', () => {
  const props = { nombre: 'Laura Paz', error: null, ocupado: false, onVolver: () => {} }

  it('al cuarto dígito llama onCompleto una vez', () => {
    const onCompleto = vi.fn()
    render(<TecladoPin {...props} onCompleto={onCompleto} />)
    for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByRole('button', { name: d }))
    expect(onCompleto).toHaveBeenCalledTimes(1)
    expect(onCompleto).toHaveBeenCalledWith('1234')
  })

  it('Borrar quita el último dígito', () => {
    const onCompleto = vi.fn()
    render(<TecladoPin {...props} onCompleto={onCompleto} />)
    for (const d of ['1', '2', '9']) fireEvent.click(screen.getByRole('button', { name: d }))
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    for (const d of ['3', '4']) fireEvent.click(screen.getByRole('button', { name: d }))
    expect(onCompleto).toHaveBeenCalledWith('1234')
  })

  it('con error muestra el mensaje y vacía los puntos', () => {
    const { rerender, container } = render(<TecladoPin {...props} onCompleto={() => {}} />)
    for (const d of ['1', '2']) fireEvent.click(screen.getByRole('button', { name: d }))
    rerender(<TecladoPin {...props} error="PIN incorrecto. Probá de nuevo." onCompleto={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('PIN incorrecto. Probá de nuevo.')
    expect(container.querySelectorAll('.pin-punto.lleno')).toHaveLength(0)
  })
})
