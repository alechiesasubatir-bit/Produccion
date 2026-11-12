import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Resultado } from '../lib/acciones'
import { FormularioControl } from './FormularioControl'

afterEach(cleanup)

const ok = (): Promise<Resultado> => Promise.resolve({ ok: true })

function montar(props: Partial<Parameters<typeof FormularioControl>[0]> = {}) {
  const onAprobar = vi.fn(ok)
  const onRechazar = vi.fn(ok)
  const onCancelar = vi.fn()
  render(
    <FormularioControl esPolvo={false} intento={2} onAprobar={onAprobar} onRechazar={onRechazar} onCancelar={onCancelar} {...props} />,
  )
  return { onAprobar, onRechazar, onCancelar }
}

const click = (el: HTMLElement) => fireEvent.click(el)
const escribir = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })

const marcar = (grupo: string, opcion: 'OK' | 'No OK') =>
  click(within(screen.getByRole('group', { name: grupo })).getByRole('button', { name: opcion }))

test('muestra el encabezado con el intento y el producto', () => {
  montar({ producto: 'Detergente X' })
  expect(screen.getByText(/Control — Intento 2/)).toBeInTheDocument()
  expect(screen.getByText(/Detergente X/)).toBeInTheDocument()
})

test('polvo oculta pH y densidad', () => {
  montar({ esPolvo: true })
  expect(screen.queryByLabelText('pH')).toBeNull()
  expect(screen.queryByLabelText('Densidad')).toBeNull()
})

test('no muestra errores en un formulario virgen y bloquea al aprobar incompleto', async () => {
  const { onAprobar } = montar()
  expect(screen.queryByText('Falta el pH.')).toBeNull()
  click(screen.getByRole('button', { name: 'Aprobar' }))
  expect(screen.getByText('Falta el pH.')).toBeInTheDocument()
  expect(screen.getByText('Falta la densidad.')).toBeInTheDocument()
  expect(screen.queryByText(/¿Aprobar el control\?/)).toBeNull()
  expect(onAprobar).not.toHaveBeenCalled()
})

test('No OK muestra el comentario y lo exige', async () => {
  montar({ esPolvo: true })
  marcar('Visual', 'OK')
  marcar('Perfume', 'No OK')
  expect(screen.getByLabelText('¿Qué está mal?')).toBeInTheDocument()
  click(screen.getByRole('button', { name: 'Rechazar' }))
  expect(screen.getByText('Explicá qué está mal.')).toBeInTheDocument()
})

async function llenarOk() {
  escribir(screen.getByLabelText('pH'), '7,5')
  escribir(screen.getByLabelText('Densidad'), '1,02')
  marcar('Perfume', 'OK')
  marcar('Visual', 'OK')
}

test('aprobar confirma y pasa los valores crudos', async () => {
  const { onAprobar } = montar()
  llenarOk()
  expect(within(screen.getByRole('group', { name: 'Perfume' })).getByRole('button', { name: 'OK' })).toHaveAttribute('aria-pressed', 'true')
  click(screen.getByRole('button', { name: 'Aprobar' }))
  expect(screen.getByText('¿Aprobar el control? El tanque queda listo para envasar.')).toBeInTheDocument()
  expect(onAprobar).not.toHaveBeenCalled()
  click(screen.getByRole('button', { name: 'Sí, aprobar' }))
  expect(onAprobar).toHaveBeenCalledWith(expect.objectContaining({ ph: '7,5', densidad: '1,02', perfumeOk: true, visualOk: true }))
})

test('aprobar con No OK pide confirmación extra', async () => {
  montar()
  escribir(screen.getByLabelText('pH'), '7')
  escribir(screen.getByLabelText('Densidad'), '1')
  marcar('Perfume', 'No OK')
  escribir(screen.getByLabelText('¿Qué está mal?'), 'huele raro')
  marcar('Visual', 'OK')
  click(screen.getByRole('button', { name: 'Aprobar' }))
  expect(screen.getByText('Hay puntos No OK. ¿Aprobar igual?')).toBeInTheDocument()
})

test('rechazar confirma con su texto y volver regresa al formulario', async () => {
  const { onRechazar } = montar()
  llenarOk()
  click(screen.getByRole('button', { name: 'Rechazar' }))
  expect(screen.getByText('La fabricación vuelve a fabricando.')).toBeInTheDocument()
  click(screen.getByRole('button', { name: 'Volver' }))
  expect(screen.getByLabelText('pH')).toBeInTheDocument()
  click(screen.getByRole('button', { name: 'Rechazar' }))
  click(screen.getByRole('button', { name: 'Sí, rechazar' }))
  expect(onRechazar).toHaveBeenCalledTimes(1)
})

test('error del servidor en role=alert y vuelve al formulario', async () => {
  montar({ onAprobar: () => Promise.resolve({ ok: false, codigo: 'TRANSICION_INVALIDA', texto: 'Ya no está en control.' }) })
  llenarOk()
  click(screen.getByRole('button', { name: 'Aprobar' }))
  click(screen.getByRole('button', { name: 'Sí, aprobar' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ya no está en control.'))
  expect(screen.getByLabelText('pH')).toBeInTheDocument()
})

test('cancelar llama onCancelar', async () => {
  const { onCancelar } = montar()
  click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(onCancelar).toHaveBeenCalled()
})
