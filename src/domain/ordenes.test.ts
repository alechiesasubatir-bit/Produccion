import { describe, expect, it } from 'vitest'
import { validarEnvasado, validarFabricacion, validarFraccionado } from './ordenes'

const fab = { tanque_id: 't1', producto_id: 'p1', litros: 1000, lote: '', operaria_id: null }

describe('validarFabricacion', () => {
  it('no deja pasar la capacidad', () => {
    expect(validarFabricacion({ ...fab, litros: 2500 }, { capacidad: 2000, tanqueLibre: true }).litros).toBe('Máximo 2000 L.')
  })
  it('el tanque tiene que estar libre', () => {
    expect(validarFabricacion(fab, { capacidad: 2000, tanqueLibre: false }).tanque_id).toBe('Ese tanque no está libre.')
  })
  it('una orden válida no tiene errores', () => {
    expect(validarFabricacion(fab, { capacidad: 2000, tanqueLibre: true })).toEqual({})
  })
  it('producto y litros requeridos', () => {
    const e = validarFabricacion({ ...fab, producto_id: '', litros: 0 }, { capacidad: 2000, tanqueLibre: true })
    expect(e.producto_id).toBe('Elegí un producto.')
    expect(e.litros).toBe('Tiene que ser mayor a 0.')
  })
})

const env = { fabricacion_id: 'f1', presentacion_id: 'pr1', cantidad: 100, etiquetado: '', operaria_1: null, operaria_2: null }

describe('validarEnvasado', () => {
  it('avisa si usa más litros de los que quedan, sin bloquear', () => {
    const r = validarEnvasado(env, { litrosRestantes: 300, litrosEquiv: 5 })
    expect(r.advertencia).toBe('Quedan 300 L sin asignar en el tanque y esta orden usa 500 L.')
    expect(r.errores).toEqual({})
  })
  it('cantidad entera mayor a 0', () => {
    expect(validarEnvasado({ ...env, cantidad: 2.5 }, { litrosRestantes: 300, litrosEquiv: 5 }).errores.cantidad).toBe(
      'Tiene que ser un número entero mayor a 0.',
    )
  })
  it('las dos operarias tienen que ser distintas', () => {
    expect(
      validarEnvasado({ ...env, operaria_1: 'E1', operaria_2: 'E1' }, { litrosRestantes: 300, litrosEquiv: 5 }).errores.operaria_2,
    ).toBe('Elegí otra operaria.')
  })
})

describe('validarFraccionado', () => {
  it('tipo y cantidad', () => {
    const e = validarFraccionado({
      tipo: '',
      descripcion: '',
      producto_id: null,
      presentacion_id: null,
      cantidad: 0,
      lote: '',
      etiquetado: '',
      operaria_id: null,
    })
    expect(e.tipo).toBe('Indicá el tipo.')
    expect(e.cantidad).toBe('Tiene que ser un número entero mayor a 0.')
  })
})
