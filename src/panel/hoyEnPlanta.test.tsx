import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FilaFlujo } from '../domain/flujo'
import { resumenDia } from '../domain/flujoDia'
import { HoyEnPlanta } from './HoyEnPlanta'

const fila = (over: Partial<FilaFlujo>): FilaFlujo =>
  ({
    entidad: 'fabricacion', id: 'f1', estado: 'finalizada', producto: 'Lavandina', color: '#0284c7', tanque_codigo: 'T-01', presentacion: null,
    cantidad: null, litros: 1000, lote: null, descripcion: null, operaria_1: null, operaria_2: null, listo: true, inicio: null, min_efectivos: 120,
    corriendo: false, created_at: '2026-11-20T10:00:00Z', fin: '2026-11-20T12:30:00Z', fabricacion_id: null, litros_restantes: null, producto_tipo: null,
    operarias: [], etiqueta: null, control_intento: null, control_rechazo: null, lote_doc: null, granel_id: null, origen: null, ...over,
  }) as FilaFlujo

describe('Hoy en planta', () => {
  it('muestra lo terminado por hora, el detalle contra el estándar, quién trabaja y los tanques', () => {
    const terminada = fila({})
    const enCurso = fila({ id: 'f2', estado: 'fabricando', fin: null, operarias: [{ empleado_id: 'A', nombre: 'Ana Gómez', desde: '2026-11-20T11:00:00Z' }] })
    render(
      <HoyEnPlanta
        resumen={resumenDia([terminada, enCurso])}
        terminadas={[terminada]}
        tanques={['fabricando', 'libre', 'libre']}
        proyeccion={() => 100}
      />,
    )
    const region = screen.getByRole('region', { name: 'Hoy en planta' })
    expect(region).toHaveTextContent('1.000 litros fabricados hoy')
    expect(within(region).getByRole('listitem', { name: /^09:00 a 10:00 · 1\.000 L · 1 orden/ })).toBeInTheDocument()
    // 120 min contra 100 estimados: +20 %, en rojo
    expect(within(region).getByText('+20 %')).toHaveClass('prod-baja')
    expect(within(region).getByText('Ana Gómez')).toBeInTheDocument()
    expect(within(region).getByRole('img', { name: '1 trabajando, 0 esperando, 0 en pausa, 2 libres' })).toBeInTheDocument()

    fireEvent.click(within(region).getByRole('button', { name: 'Unidades' }))
    expect(region).toHaveTextContent('Todavía no terminó nada hoy.')
  })
})
