import { describe, expect, it } from 'vitest'
import { validarEnvasado, validarFabricacion, validarFabricacionFormula, validarFraccionado } from './ordenes'

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

const env = { fabricacion_id: 'f1', presentacion_id: 'pr1', cantidad: 100, etiquetar: false, etiqueta_id: null, operaria_1: null, operaria_2: null }

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
      etiquetar: false,
      etiqueta_id: null,
      operaria_id: null,
    })
    expect(e.tipo).toBe('Indicá el tipo.')
    expect(e.cantidad).toBe('Tiene que ser un número entero mayor a 0.')
  })
})

describe('etiquetado Sí/No', () => {
  const ctx = { litrosRestantes: null, litrosEquiv: null }
  it('envasado: con Sí hay que elegir etiqueta', () => {
    expect(validarEnvasado({ ...env, etiquetar: true }, ctx).errores.etiqueta_id).toBe('Elegí una etiqueta.')
    expect(validarEnvasado({ ...env, etiquetar: true, etiqueta_id: 'e1' }, ctx).errores.etiqueta_id).toBeUndefined()
    expect(validarEnvasado(env, ctx).errores.etiqueta_id).toBeUndefined()
  })
  it('fraccionado: con Sí hay que elegir etiqueta', () => {
    const f = { tipo: 'x', descripcion: '', producto_id: null, presentacion_id: null, cantidad: 1, lote: '', etiquetar: true, etiqueta_id: null, operaria_id: null }
    expect(validarFraccionado(f).etiqueta_id).toBe('Elegí una etiqueta.')
    expect(validarFraccionado({ ...f, etiqueta_id: 'e1' }).etiqueta_id).toBeUndefined()
  })
})

const formula = { ...fab, lote: '17702', vencimiento: '2028-10-21', fecha_formula: '2026-10-21', codigo_producto: 'F8' }
const ctxFormula = { capacidad: 2000, tanqueLibre: true, loteExiste: false }

describe('validarFabricacionFormula', () => {
  it('una fórmula completa no tiene errores', () => {
    expect(validarFabricacionFormula(formula, ctxFormula)).toEqual({})
  })
  it('suma los errores de validarFabricacion', () => {
    expect(validarFabricacionFormula({ ...formula, litros: 2500 }, ctxFormula).litros).toBe('Máximo 2000 L.')
  })
  it('el vencimiento es obligatorio', () => {
    expect(validarFabricacionFormula({ ...formula, vencimiento: '' }, ctxFormula).vencimiento).toBe('Poné la fecha de vencimiento')
  })
  it('el vencimiento tiene que ser posterior a la fecha de la fórmula', () => {
    const msg = 'El vencimiento tiene que ser posterior a la fecha de la fórmula'
    expect(validarFabricacionFormula({ ...formula, vencimiento: '2026-10-21' }, ctxFormula).vencimiento).toBe(msg)
    expect(validarFabricacionFormula({ ...formula, vencimiento: '2026-10-01' }, ctxFormula).vencimiento).toBe(msg)
  })
  it('avisa si el lote ya existe', () => {
    expect(validarFabricacionFormula(formula, { ...ctxFormula, loteExiste: true }).lote).toBe('Ya existe una fabricación con el lote 17702')
  })
  it('lote y fecha de la fórmula obligatorios (si el PDF no los trajo)', () => {
    const e = validarFabricacionFormula({ ...formula, lote: ' ', fecha_formula: '' }, ctxFormula)
    expect(e.lote).toBe('Poné el lote')
    expect(e.fecha_formula).toBe('Poné la fecha de la fórmula')
  })
})
