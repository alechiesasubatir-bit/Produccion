import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import { Confirmacion } from './Confirmacion'
import { MisTareas } from './MisTareas'
import { TarjetaTarea } from './TarjetaTarea'

let n = 0
function tarea(over: Partial<Tarea> = {}): Tarea {
  n += 1
  return {
    entidad: 'fabricacion',
    id: `t${n}`,
    estado: 'cola',
    producto: 'Lavandina',
    color: '#0284c7',
    tanque_codigo: 'T-01',
    presentacion: null,
    cantidad: null,
    litros: 1000,
    lote: null,
    descripcion: null,
    operaria_1: null,
    operaria_2: null,
    listo: true,
    inicio: null,
    min_efectivos: null,
    corriendo: false,
    created_at: `2026-10-21T10:${String(n).padStart(2, '0')}:00Z`,
    ...over,
  }
}

const base = {
  nombre: 'Laura Paz',
  empleadoId: 'E1',
  tanque: null,
  conectado: true,
  cargadoEn: Date.now(),
  aviso: null,
  onAccion: () => {},
  onSalir: () => {},
}

describe('MisTareas', () => {
  it('sin conexión: banda visible y botones deshabilitados', () => {
    const tareas = [tarea(), tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E1' })]
    render(<MisTareas {...base} tareas={tareas} conectado={false} />)
    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument()
    for (const b of screen.getAllByRole('button', { name: /Tomar|Pausar|Finalizar/ })) expect(b).toBeDisabled()
  })

  it('la tarea del tanque del QR va primera en disponibles', () => {
    const tareas = [tarea({ tanque_codigo: 'T-01' }), tarea({ tanque_codigo: 'T-03' })]
    render(<MisTareas {...base} tareas={tareas} tanque="T-03" />)
    const disponibles = screen.getByRole('region', { name: 'Disponibles para tomar' })
    expect(within(disponibles).getAllByRole('article')[0]).toHaveTextContent('T-03')
  })

  it('muestra el aviso como alerta', () => {
    render(<MisTareas {...base} tareas={[]} aviso="Esta tarea ya la finalizó Rosa Díaz a las 10:15." />)
    expect(screen.getByRole('alert')).toHaveTextContent('Rosa Díaz')
  })
})

describe('TarjetaTarea', () => {
  it('disponible: botón Tomar que inicia', () => {
    const onAccion = vi.fn()
    render(<TarjetaTarea tarea={tarea()} disponible habilitado cargadoEn={Date.now()} onAccion={onAccion} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tomar' }))
    expect(onAccion).toHaveBeenCalledWith('iniciar')
  })

  it('fabricando: Pausar y Finalizar, nunca Cancelar', () => {
    render(
      <TarjetaTarea
        tarea={tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E1' })}
        disponible={false}
        habilitado
        cargadoEn={Date.now()}
        onAccion={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
  })

  describe('cronómetro', () => {
    afterEach(() => vi.useRealTimers())
    it('avanza cada segundo si está corriendo', () => {
      vi.useFakeTimers()
      render(
        <TarjetaTarea
          tarea={tarea({ estado: 'fabricando', corriendo: true, min_efectivos: 1, operaria_1: 'E1' })}
          disponible={false}
          habilitado
          cargadoEn={Date.now()}
          onAccion={() => {}}
        />,
      )
      expect(screen.getByRole('timer')).toHaveTextContent('01:00')
      act(() => vi.advanceTimersByTime(5000))
      expect(screen.getByRole('timer')).toHaveTextContent('01:05')
    })
  })
})

describe('Confirmacion', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('con reduced motion termina sin esperar', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const onFin = vi.fn()
    render(<Confirmacion color="#db2777" texto="Listo: finalizaste Lavandina · 1000 L" onFin={onFin} />)
    expect(onFin).toHaveBeenCalledTimes(1)
  })
})
