import { describe, expect, it } from 'vitest'
import { FALTA_MOTIVO_RECHAZO, FORM_CONTROL_VACIO, hayNoOk, motivoRechazo, validarControl, type FormControl } from './control'

const ok: FormControl = { ...FORM_CONTROL_VACIO, ph: '7,5', densidad: '1.02', perfumeOk: true, visualOk: true }

describe('validarControl', () => {
  it('formulario completo sin errores', () => {
    expect(validarControl(ok, false)).toEqual({})
  })
  it('vacío pide todo', () => {
    expect(validarControl(FORM_CONTROL_VACIO, false)).toEqual({
      ph: 'Falta el pH.',
      densidad: 'Falta la densidad.',
      perfumeOk: 'Marcá OK o No OK.',
      visualOk: 'Marcá OK o No OK.',
    })
  })
  it('pH de 0 a 14 con coma decimal', () => {
    expect(validarControl({ ...ok, ph: '0' }, false).ph).toBeUndefined()
    expect(validarControl({ ...ok, ph: '14' }, false).ph).toBeUndefined()
    expect(validarControl({ ...ok, ph: '14,1' }, false).ph).toBe('El pH va de 0 a 14.')
    expect(validarControl({ ...ok, ph: 'abc' }, false).ph).toBe('El pH va de 0 a 14.')
  })
  it('densidad mayor a 0', () => {
    expect(validarControl({ ...ok, densidad: '0' }, false).densidad).toBe('La densidad tiene que ser mayor a 0.')
    expect(validarControl({ ...ok, densidad: '-1' }, false).densidad).toBe('La densidad tiene que ser mayor a 0.')
  })
  it('polvo no mide pH ni densidad', () => {
    expect(validarControl({ ...ok, ph: '', densidad: '' }, true)).toEqual({})
  })
  it('No OK exige comentario', () => {
    const e = validarControl({ ...ok, perfumeOk: false, visualOk: false, visualComentario: '  ' }, false)
    expect(e).toEqual({ perfumeComentario: 'Explicá qué está mal.', visualComentario: 'Explicá qué está mal.' })
  })
  it('rechazar exige un motivo: algo No OK o una observación', () => {
    expect(FALTA_MOTIVO_RECHAZO).toBe('Para rechazar, marcá qué está mal o escribí una observación.')
    expect(validarControl(ok, false, 'rechazado')).toEqual({ observaciones: FALTA_MOTIVO_RECHAZO })
    expect(validarControl({ ...ok, observaciones: '   ' }, false, 'rechazado')).toEqual({ observaciones: FALTA_MOTIVO_RECHAZO })
    expect(validarControl({ ...ok, observaciones: 'grumoso' }, false, 'rechazado')).toEqual({})
    expect(validarControl({ ...ok, perfumeOk: false, perfumeComentario: 'flojo' }, false, 'rechazado')).toEqual({})
  })
  it('aprobar no exige motivo', () => {
    expect(validarControl(ok, false, 'aprobado')).toEqual({})
    expect(validarControl(ok, false)).toEqual({})
  })
})

describe('hayNoOk', () => {
  it('detecta cualquier No OK', () => {
    expect(hayNoOk(ok)).toBe(false)
    expect(hayNoOk({ ...ok, visualOk: false })).toBe(true)
    expect(hayNoOk({ perfumeOk: null, visualOk: null })).toBe(false)
  })
})

describe('motivoRechazo', () => {
  it('une los No OK y las observaciones con «; »', () => {
    expect(
      motivoRechazo({ ...ok, perfumeOk: false, perfumeComentario: 'muy suave', visualOk: false, visualComentario: 'turbio', observaciones: 'repetir' }),
    ).toBe('perfume No OK (muy suave); visual No OK (turbio); repetir')
  })
  it('solo observaciones o vacío', () => {
    expect(motivoRechazo({ ...ok, observaciones: 'ok igual' })).toBe('ok igual')
    expect(motivoRechazo(ok)).toBe('')
  })
})
