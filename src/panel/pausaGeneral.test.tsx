import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilaFlujo } from '../domain/flujo'
import { BotonPausaGeneral, FranjaPausa } from './PausaGeneral'

const m = vi.hoisted(() => ({
  flujo: [] as unknown[],
  operarias: [] as { empleado_id: string; nombre: string }[],
  ordenesPausa: [] as unknown[],
  pausaGeneral: vi.fn(),
  arranqueGeneral: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('./datosFlujo', () => ({
  cargarFlujo: () => Promise.resolve(m.flujo),
  cargarOperarias: () => Promise.resolve(m.operarias),
}))
vi.mock('./datosPausaGeneral', () => ({ cargarOrdenesPausa: () => Promise.resolve(m.ordenesPausa) }))
vi.mock('../lib/acciones', () => ({ pausaGeneral: m.pausaGeneral, arranqueGeneral: m.arranqueGeneral }))

const fila = (over: Partial<FilaFlujo>): FilaFlujo => ({
  entidad: 'fabricacion',
  id: 'f1',
  estado: 'fabricando',
  producto: 'Shampoo',
  color: null,
  tanque_codigo: 'T1',
  presentacion: null,
  cantidad: null,
  litros: 500,
  lote: null,
  descripcion: null,
  operaria_1: null,
  operaria_2: null,
  listo: false,
  inicio: '2026-11-16T12:00:00Z',
  min_efectivos: null,
  corriendo: true,
  created_at: '2026-11-16T11:00:00Z',
  fin: null,
  fabricacion_id: null,
  litros_restantes: null,
  producto_tipo: 'liquido',
  operarias: [],
  etiqueta: null,
  control_intento: null,
  control_rechazo: null,
  lote_doc: null,
  granel_id: null,
  origen: 'formula',
  ...over,
} as FilaFlujo)

const op = (empleado_id: string, nombre: string) => ({ empleado_id, nombre, desde: '2026-11-16T12:00:00Z' })

const PAUSA = { id: 'p1', inicio: '2026-11-16T21:30:00Z' } // 18:30 en Montevideo

const montar = async (pausa: { id: string; inicio: string } | null) => {
  await act(async () => {
    render(<BotonPausaGeneral pausa={pausa} />)
  })
}

const abrir = async (nombre: RegExp | string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: nombre }))
  })
}

describe('BotonPausaGeneral', () => {
  beforeEach(() => {
    m.flujo = []
    m.operarias = []
    m.ordenesPausa = []
    m.pausaGeneral.mockReset().mockResolvedValue({ ok: true, pausaId: 'p1' })
    m.arranqueGeneral.mockReset().mockResolvedValue({ ok: true })
  })

  it('sin pausa dice «Pausa General»', async () => {
    await montar(null)
    expect(screen.getByRole('button', { name: 'Pausa General' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Arranque/ })).not.toBeInTheDocument()
  })

  it('con pausa dice «Arranque» y «en pausa desde HH:MM»', async () => {
    await montar(PAUSA)
    expect(screen.getByRole('button', { name: /Arranque/ })).toBeInTheDocument()
    expect(screen.getByText('en pausa desde 18:30')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pausa General' })).not.toBeInTheDocument()
  })

  it('si la pausa cambia con el diálogo de pausa abierto, se cierra (no se vuelve Arranque)', async () => {
    m.flujo = [fila({})]
    let r!: ReturnType<typeof render>
    await act(async () => {
      r = render(<BotonPausaGeneral pausa={null} />)
    })
    await abrir('Pausa General')
    expect(screen.getByRole('dialog', { name: 'Pausa General' })).toBeInTheDocument()
    await act(async () => {
      r.rerender(<BotonPausaGeneral pausa={PAUSA} />)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // y no reaparece si la pausa vuelve a cambiar
    await act(async () => {
      r.rerender(<BotonPausaGeneral pausa={null} />)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('si levantan la pausa con el diálogo de arranque abierto, se cierra (no se vuelve Pausa General)', async () => {
    let r!: ReturnType<typeof render>
    await act(async () => {
      r = render(<BotonPausaGeneral pausa={PAUSA} />)
    })
    await abrir(/Arranque/)
    expect(screen.getByRole('dialog', { name: 'Arranque' })).toBeInTheDocument()
    await act(async () => {
      r.rerender(<BotonPausaGeneral pausa={null} />)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('tras una pausa exitosa avisa para recargar la pausa', async () => {
    m.flujo = [fila({})]
    const onCambio = vi.fn()
    await act(async () => {
      render(<BotonPausaGeneral pausa={null} onCambio={onCambio} />)
    })
    await abrir('Pausa General')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar pausa' }))
    })
    expect(onCambio).toHaveBeenCalledTimes(1)
  })

  describe('diálogo de pausa', () => {
    it('lista las órdenes agrupadas, exige las cantidades y llama pausaGeneral con lo tipeado', async () => {
      m.flujo = [
        fila({ entidad: 'fabricacion', id: 'f1', producto: 'Shampoo', operarias: [op('e1', 'Ana')] }),
        fila({
          entidad: 'envasado',
          id: 'v1',
          estado: 'activo',
          producto: 'Acondicionador',
          presentacion: 'Bidón 5 L',
          operarias: [op('e2', 'Bea'), op('e3', 'Caro')],
        }),
        fila({ entidad: 'fabricacion', id: 'f9', estado: 'finalizada', producto: 'Viejo' }),
      ]
      await montar(null)
      await abrir('Pausa General')
      const dialogo = screen.getByRole('dialog', { name: 'Pausa General' })
      expect(within(dialogo).getByRole('heading', { name: 'Fabricación' })).toBeInTheDocument()
      expect(within(dialogo).getByRole('heading', { name: 'Envasado' })).toBeInTheDocument()
      expect(within(dialogo).getByText('Shampoo')).toBeInTheDocument()
      expect(within(dialogo).getByText('Acondicionador')).toBeInTheDocument()
      expect(within(dialogo).queryByText('Viejo')).not.toBeInTheDocument()

      const confirmar = within(dialogo).getByRole('button', { name: 'Confirmar pausa' })
      expect(confirmar).toBeDisabled()
      fireEvent.change(within(dialogo).getByLabelText('Cantidad de Bea'), { target: { value: '120' } })
      expect(confirmar).toBeDisabled()
      fireEvent.change(within(dialogo).getByLabelText('Cantidad de Caro'), { target: { value: '80,5' } })
      expect(confirmar).toBeEnabled()

      await act(async () => {
        fireEvent.click(confirmar)
      })
      expect(m.pausaGeneral).toHaveBeenCalledWith([
        { entidad: 'envasado', id: 'v1', empleadoId: 'e2', cantidad: 120, unidad: 'L' },
        { entidad: 'envasado', id: 'v1', empleadoId: 'e3', cantidad: 80.5, unidad: 'L' },
      ])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('un producto polvo arranca en kg', async () => {
      m.flujo = [
        fila({ entidad: 'fraccionado', id: 'r1', estado: 'activo', producto: 'Detergente polvo', producto_tipo: 'polvo', operarias: [op('e1', 'Ana')] }),
      ]
      await montar(null)
      await abrir('Pausa General')
      expect(screen.getByRole('heading', { name: 'Fraccionado' })).toBeInTheDocument()
      expect(screen.getByLabelText('Unidad de Detergente polvo')).toHaveValue('kg')
      fireEvent.change(screen.getByLabelText('Cantidad de Ana'), { target: { value: '3' } })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar pausa' }))
      })
      expect(m.pausaGeneral).toHaveBeenCalledWith([
        { entidad: 'fraccionado', id: 'r1', empleadoId: 'e1', cantidad: 3, unidad: 'kg' },
      ])
    })

    it('muestra el error del servidor', async () => {
      m.flujo = [fila({})]
      m.pausaGeneral.mockResolvedValue({ ok: false, codigo: 'PAUSA_GENERAL_ACTIVA', texto: 'Ya hay una pausa general en curso.' })
      await montar(null)
      await abrir('Pausa General')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar pausa' }))
      })
      expect(screen.getByRole('alert')).toHaveTextContent('Ya hay una pausa general en curso.')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('sin órdenes muestra «No hay órdenes en marcha» y no deja confirmar', async () => {
      m.flujo = [fila({ estado: 'cola' })]
      await montar(null)
      await abrir('Pausa General')
      expect(screen.getByText('No hay órdenes en marcha')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirmar pausa' })).toBeDisabled()
    })
  })

  describe('diálogo de arranque', () => {
    beforeEach(() => {
      m.operarias = [
        { empleado_id: 'e1', nombre: 'Ana' },
        { empleado_id: 'e2', nombre: 'Bea' },
        { empleado_id: 'e3', nombre: 'Caro' },
      ]
      m.flujo = [
        fila({ entidad: 'fabricacion', id: 'f1', estado: 'pausada', producto: 'Shampoo' }),
        fila({ entidad: 'envasado', id: 'v1', estado: 'pausado', producto: 'Acondicionador' }),
        fila({ entidad: 'fabricacion', id: 'f2', estado: 'finalizada', producto: 'Jabón' }),
        fila({ entidad: 'fabricacion', id: 'f3', estado: 'fabricando', producto: 'Crema' }),
      ]
      m.ordenesPausa = [
        { pausa_id: 'p1', entidad: 'fabricacion', entidad_id: 'f1', estaba: 'en_curso', operarias: ['e1'] },
        { pausa_id: 'p1', entidad: 'envasado', entidad_id: 'v1', estaba: 'pausada', operarias: ['e2'] },
        { pausa_id: 'p1', entidad: 'fabricacion', entidad_id: 'f2', estaba: 'en_curso', operarias: ['e3'] },
        { pausa_id: 'p1', entidad: 'fabricacion', entidad_id: 'f3', estaba: 'en_curso', operarias: ['e3'] },
      ]
    })

    const orden = (producto: string) => screen.getByRole('group', { name: producto })

    it('prellena reanudar y operarias; las cerradas no tienen controles', async () => {
      await montar(PAUSA)
      await abrir(/Arranque/)
      expect(within(orden('Shampoo')).getByRole('checkbox', { name: 'Reanudar' })).toBeChecked()
      expect(within(orden('Shampoo')).getByRole('checkbox', { name: 'Ana' })).toBeChecked()
      expect(within(orden('Acondicionador')).getByRole('checkbox', { name: 'Reanudar' })).not.toBeChecked()
      expect(within(orden('Acondicionador')).getByRole('checkbox', { name: 'Bea' })).toBeChecked()

      expect(within(orden('Jabón')).getByText('cerrada en la noche')).toBeInTheDocument()
      expect(within(orden('Jabón')).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(within(orden('Crema')).getByText('reanudada durante la noche')).toBeInTheDocument()
      expect(within(orden('Crema')).queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('destildar a todas las operarias de una orden marcada pide elegir una', async () => {
      await montar(PAUSA)
      await abrir(/Arranque/)
      fireEvent.click(within(orden('Shampoo')).getByRole('checkbox', { name: 'Ana' }))
      expect(within(orden('Shampoo')).getByText('Elegí al menos una operaria.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirmar arranque' })).toBeDisabled()
    })

    it('confirma solo con las marcadas, con las operarias sumadas', async () => {
      await montar(PAUSA)
      await abrir(/Arranque/)
      fireEvent.change(within(orden('Shampoo')).getByLabelText('Sumar operaria'), { target: { value: 'e3' } })
      expect(within(orden('Shampoo')).getByRole('checkbox', { name: 'Caro' })).toBeChecked()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar arranque' }))
      })
      expect(m.arranqueGeneral).toHaveBeenCalledWith([{ entidad: 'fabricacion', id: 'f1', empleados: ['e1', 'e3'] }])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('una operaria de anoche que ya no está activa no se premarca ni se muestra', async () => {
      m.operarias = m.operarias.filter((o) => o.empleado_id !== 'e1')
      m.flujo = [...m.flujo, fila({ entidad: 'envasado', id: 'v9', estado: 'activo', operarias: [op('e1', 'Ana')] })]
      await montar(PAUSA)
      await abrir(/Arranque/)
      expect(within(orden('Shampoo')).queryByRole('checkbox', { name: 'Ana' })).not.toBeInTheDocument()
      expect(within(orden('Shampoo')).queryByText('Operaria')).not.toBeInTheDocument()
      expect(within(orden('Shampoo')).getByText('Elegí al menos una operaria.')).toBeInTheDocument()
    })

    it('tras el arranque exitoso avisa para recargar la pausa', async () => {
      const onCambio = vi.fn()
      await act(async () => {
        render(<BotonPausaGeneral pausa={PAUSA} onCambio={onCambio} />)
      })
      await abrir(/Arranque/)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar arranque' }))
      })
      expect(onCambio).toHaveBeenCalledTimes(1)
    })

    it('muestra el error del servidor', async () => {
      m.arranqueGeneral.mockResolvedValue({ ok: false, codigo: 'TRANSICION_INVALIDA', texto: 'Shampoo se cerró durante la noche.' })
      await montar(PAUSA)
      await abrir(/Arranque/)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar arranque' }))
      })
      expect(screen.getByRole('alert')).toHaveTextContent('Shampoo se cerró durante la noche.')
    })
  })
})

describe('FranjaPausa', () => {
  it('avisa desde qué hora está en pausa la planta', () => {
    render(<FranjaPausa pausa={PAUSA} />)
    expect(screen.getByRole('status')).toHaveTextContent('Planta en pausa general desde 18:30')
  })
})
