import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FilaFlujo } from '../../domain/flujo'
import type { EstadoTanqueFila } from '../../pages/ParedTanques'
import { Monitor } from './Monitor'

const m = vi.hoisted(() => ({ pausa: null as { id: string; inicio: string } | null, flujo: [] as unknown[], tanques: [] as unknown[], canales: {} as Record<string, string[]> }))

vi.mock('../datosPausaGeneral', () => ({ usePausaGeneral: () => m.pausa }))
vi.mock('../../lib/supabase', () => ({ db: {}, fetchAll: vi.fn() }))
vi.mock('../../lib/useRealtime', () => ({
  useRealtime: (tabla: string, _cargar: unknown, canales: string[]) => ({
    ...(m.canales[tabla] = canales, {}),
    datos: tabla === 'v_flujo' ? m.flujo : tabla === 'v_tanque_estado' ? m.tanques : [{ empleado_id: 'E1', nombre: 'Laura Paz' }],
    cargado: true,
    conectado: true,
    enVivo: true,
    error: null,
    recargar: vi.fn(),
  }),
}))

let n = 0
function fila(over: Partial<FilaFlujo> = {}): FilaFlujo {
  n += 1
  return {
    entidad: 'fabricacion', id: `f${n}`, estado: 'fabricando', producto: 'Lavandina', color: '#facc15', producto_tipo: null, operarias: [], etiqueta: null, control_intento: null, control_rechazo: null, lote_doc: null, granel_id: null, origen: null, tanque_codigo: 'T-01',
    presentacion: null, cantidad: null, litros: 900, lote: `L-${n}`, descripcion: null, operaria_1: 'E1', operaria_2: null,
    listo: true, inicio: '2026-10-21T12:00:00Z', min_efectivos: 12, corriendo: true, created_at: `2026-10-21T10:${String(n).padStart(2, '0')}:00Z`,
    fin: null, fabricacion_id: null, litros_restantes: 900, ...over,
  }
}

function tanque(over: Partial<EstadoTanqueFila>): EstadoTanqueFila {
  return {
    tanque_id: 't1', codigo: 'T-01', capacidad_l: 2000, orden: 1, estado: 'fabricando', fabricacion_id: 'f1', producto_id: 'p1',
    producto: 'Lavandina', color: '#facc15', litros: 900, litros_restantes: 900, envasado_id: null, operaria_id: null, inicio: null, producto_tipo: null, ...over,
  }
}

const montar = () =>
  render(
    <MemoryRouter>
      <Monitor salir="/panel" />
    </MemoryRouter>,
  )

describe('Monitor (TV)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    m.pausa = null
  })

  it('con la planta en pausa general muestra la franja; sin pausa, no', () => {
    m.flujo = []
    m.tanques = []
    const v = montar()
    expect(screen.queryByText(/Planta en pausa general/)).not.toBeInTheDocument()
    v.unmount()
    m.pausa = { id: 'P1', inicio: '2026-11-16T15:30:00Z' }
    montar()
    expect(screen.getByText('Planta en pausa general desde 12:30')).toBeInTheDocument()
  })

  it('muestra el flujo en 5 columnas (sin Terminadas hoy), sin botones de acción', () => {
    m.flujo = [fila({}), fila({ estado: 'cola', corriendo: false, min_efectivos: null, inicio: null })]
    m.tanques = []
    montar()
    expect(screen.getAllByRole('region')).toHaveLength(5)
    expect(screen.queryByRole('region', { name: 'Terminadas hoy' })).not.toBeInTheDocument()
    const fabricando = screen.getByRole('region', { name: 'Fabricando' })
    expect(within(fabricando).getByRole('article', { name: 'Lavandina · 900 L' })).toBeInTheDocument()
    expect(within(fabricando).getByText('Laura Paz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pausar|Iniciar|Finalizar|Cancelar/ })).not.toBeInTheDocument()
  })

  it('con muchas tarjetas en una columna muestra las primeras y cuántas más hay', () => {
    m.flujo = Array.from({ length: 11 }, () => fila({ estado: 'cola', corriendo: false, inicio: null, min_efectivos: null }))
    montar()
    const cola = screen.getByRole('region', { name: 'Cola' })
    expect(within(cola).getAllByRole('article')).toHaveLength(8)
    expect(within(cola).getByText('+3 más')).toBeInTheDocument()
  })

  it('escucha los cambios de participaciones para ver el equipo al día', () => {
    m.flujo = []
    montar()
    expect(m.canales.v_flujo).toContain('participaciones')
  })

  it('una fabricación en control muestra el chip y ningún botón, y escucha los controles', () => {
    m.flujo = [fila({ estado: 'en_control', control_intento: 1 })]
    m.tanques = [tanque({ estado: 'en_control' })]
    montar()
    const fabricando = screen.getByRole('region', { name: 'Fabricando' })
    expect(within(fabricando).getByText('En control')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Controlar' })).not.toBeInTheDocument()
    expect(m.canales.v_flujo).toContain('controles')
    // sin la tira de tanques abajo: las columnas usan todo el alto
    expect(screen.queryByRole('list', { name: 'Tanques' })).not.toBeInTheDocument()
  })

  it('tiene los contadores, la hora y se puede salir o pasar a pantalla completa', async () => {
    m.flujo = [fila({})]
    const pantallaCompleta = vi.fn(() => Promise.resolve())
    document.documentElement.requestFullscreen = pantallaCompleta
    montar()
    expect(screen.getByText('fabricando')).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: 'Hora' })).toHaveTextContent(/^\d{2}:\d{2}$/)
    expect(screen.getByRole('link', { name: 'Salir del monitor' })).toHaveAttribute('href', '/panel')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pantalla completa' })))
    expect(pantallaCompleta).toHaveBeenCalled()
  })
})
