import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tarea } from '../domain/tareas'
import { Confirmacion } from './Confirmacion'
import { MisTareas } from './MisTareas'
import { TarjetaTarea } from './TarjetaTarea'

const m = vi.hoisted(() => ({ setVencimiento: vi.fn() }))
vi.mock('../lib/supabase', () => ({ db: {} }))
vi.mock('../lib/acciones', () => ({ setVencimiento: m.setVencimiento, guardarMp: vi.fn() }))

let n = 0
function tarea(over: Partial<Tarea> = {}): Tarea {
  n += 1
  return {
    entidad: 'fabricacion',
    id: `t${n}`,
    estado: 'cola',
    producto: 'Lavandina',
    color: '#0284c7',
    producto_tipo: null,
    operarias: [],
    etiqueta: null,
    vencimiento: null,
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
    mp_total: 0,
    mp_completas: 0,
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

describe('operarias múltiples', () => {
  const ana = { empleado_id: 'E2', nombre: 'Ana', desde: '2026-10-21T10:00:00Z' }
  const laura = { empleado_id: 'E1', nombre: 'Laura Paz', desde: '2026-10-21T10:00:00Z' }
  const rosa = { empleado_id: 'E3', nombre: 'Rosa', desde: '2026-10-21T10:00:00Z' }

  it('secciones Mías, En curso — sumarme y Disponibles; «Con: Ana» en compartidas', () => {
    const tareas = [
      tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E1', operarias: [laura, ana] }),
      tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E2', operarias: [ana], producto: 'Detergente' }),
      tarea({ producto: 'Suavizante' }),
    ]
    render(<MisTareas {...base} tareas={tareas} />)
    expect(screen.getByRole('heading', { name: 'Mías' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'En curso — sumarme' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Disponibles' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Mis tareas' })).getByText('Con: Ana')).toBeInTheDocument()
    const en = screen.getByRole('region', { name: 'En curso para sumarme' })
    expect(within(en).getByRole('article')).toHaveTextContent('Detergente')
  })

  it('Sumarme pide confirmación y manda sumarse', () => {
    const onAccion = vi.fn()
    const t = tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E2', operarias: [ana] })
    render(<MisTareas {...base} tareas={[t]} onAccion={onAccion} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sumarme' }))
    expect(onAccion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onAccion).toHaveBeenCalledWith(t, 'sumarse')
  })

  it('Salir en envasado abre un campo y manda cantidades', () => {
    const onAccion = vi.fn()
    const t = tarea({ entidad: 'envasado', estado: 'activo', corriendo: true, operaria_1: 'E1', operarias: [laura, ana] })
    render(<MisTareas {...base} tareas={[t]} onAccion={onAccion} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salir de la orden' }))
    const d = screen.getByRole('dialog', { name: '¿Cuánto envasaste?' })
    expect(within(d).getAllByRole('textbox')).toHaveLength(1)
    expect(d).toHaveTextContent('Laura Paz')
    fireEvent.change(within(d).getByRole('textbox'), { target: { value: '12' } })
    fireEvent.click(within(d).getByRole('button', { name: /Confirmar|Listo|Aceptar/ }))
    expect(onAccion).toHaveBeenCalledWith(t, 'salir', [{ empleadoId: 'E1', cantidad: 12, unidad: 'L' }])
  })

  it('Salir en fabricación confirma y manda sin cantidades', () => {
    const onAccion = vi.fn()
    const t = tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E1', operarias: [laura, ana] })
    render(<MisTareas {...base} tareas={[t]} onAccion={onAccion} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salir de la orden' }))
    expect(screen.getByText('Tus MP cargadas quedan registradas a tu nombre')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onAccion).toHaveBeenCalledWith(t, 'salir')
  })

  it('siendo la última, Salir está deshabilitado con el motivo', () => {
    const t = tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E1', operarias: [laura] })
    render(<MisTareas {...base} tareas={[t]} />)
    expect(screen.getByRole('button', { name: 'Salir de la orden' })).toBeDisabled()
    expect(screen.getByText('Sos la última: pausá o finalizá')).toBeInTheDocument()
  })

  it('Finalizar envasado con 2 operarias abre 2 campos con sus nombres', () => {
    const t = tarea({ entidad: 'envasado', estado: 'activo', corriendo: true, operaria_1: 'E1', operarias: [laura, rosa] })
    render(<MisTareas {...base} tareas={[t]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar' }))
    const d = screen.getByRole('dialog', { name: '¿Cuánto envasó cada una?' })
    expect(within(d).getAllByRole('textbox')).toHaveLength(2)
    expect(d).toHaveTextContent('Laura Paz')
    expect(d).toHaveTextContent('Rosa')
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
  it('con reduced motion el mensaje se ve igual (sin animación) antes de volver', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const onFin = vi.fn()
    render(<Confirmacion color="#db2777" texto="Listo: finalizaste Lavandina · 1000 L" onFin={onFin} />)
    expect(screen.getByText('Listo: finalizaste Lavandina · 1000 L')).toBeInTheDocument()
    expect(onFin).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1300))
    expect(onFin).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('vencimiento y etiqueta', () => {
  const laura = { empleado_id: 'E1', nombre: 'Laura Paz', desde: '2026-10-21T10:00:00Z' }
  const propia = (over: Partial<Tarea> = {}) =>
    tarea({ estado: 'fabricando', corriendo: true, operaria_1: 'E1', operarias: [laura], ...over })

  it('muestra «Vence: 12/05/2027» con botón para cambiarlo', () => {
    render(<MisTareas {...base} tareas={[propia({ vencimiento: '2027-05-12' })]} />)
    expect(screen.getByText('Vence: 12/05/2027')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar vencimiento' })).toBeInTheDocument()
  })

  it('sin vencimiento ofrece «Cargar vencimiento» y guarda la fecha elegida', async () => {
    m.setVencimiento.mockReset().mockResolvedValue({ ok: true })
    const t = propia()
    render(<MisTareas {...base} tareas={[t]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar vencimiento' }))
    fireEvent.change(screen.getByLabelText('Fecha de vencimiento'), { target: { value: '2027-05-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(m.setVencimiento).toHaveBeenCalledWith({ fabricacionId: t.id, fecha: '2027-05-12', empleadoId: 'E1' }),
    )
    expect(await screen.findByText('Vence: 12/05/2027')).toBeInTheDocument()
  })

  it('muestra el error del servidor', async () => {
    m.setVencimiento.mockReset().mockResolvedValue({ ok: false, codigo: 'NO_PARTICIPA', texto: 'No estás en esta orden.' })
    render(<MisTareas {...base} tareas={[propia()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar vencimiento' }))
    fireEvent.change(screen.getByLabelText('Fecha de vencimiento'), { target: { value: '2027-05-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No estás en esta orden.')).toBeInTheDocument()
  })

  it('no hay vencimiento en tarjetas ajenas o disponibles', () => {
    render(<MisTareas {...base} tareas={[tarea({ vencimiento: '2027-05-12' })]} />)
    expect(screen.queryByText(/Vence:/)).not.toBeInTheDocument()
  })

  it('envasado muestra la etiqueta o «Sin etiquetar»', () => {
    const e = { entidad: 'envasado' as const, estado: 'cola' as const, tanque_codigo: null }
    render(<MisTareas {...base} tareas={[tarea({ ...e, etiqueta: 'Etiqueta-test' }), tarea({ ...e, etiqueta: null })]} />)
    expect(screen.getByText('Etiqueta: Etiqueta-test')).toBeInTheDocument()
    expect(screen.getByText('Sin etiquetar')).toBeInTheDocument()
  })
})
