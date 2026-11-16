import { describe, expect, it } from 'vitest'
import type { FilaFlujo } from './flujo'
import {
  armarArranque,
  erroresArranque,
  faltanCantidades,
  ordenesEnMarcha,
  pideCantidad,
  unidadPorDefecto,
} from './pausaGeneral'

function fila(p: Partial<FilaFlujo> & Pick<FilaFlujo, 'entidad' | 'id' | 'estado'>): FilaFlujo {
  return { producto: 'Lavandina', producto_tipo: 'liquido', operarias: [], ...p } as FilaFlujo
}

const op = (id: string) => ({ empleado_id: id, nombre: id, desde: '2026-11-16T10:00:00Z' })

describe('ordenesEnMarcha', () => {
  it('incluye solo las que están en marcha y las ordena por entidad y producto', () => {
    const flujo = [
      fila({ entidad: 'fraccionado', id: 'fr', estado: 'activo', producto: 'A' }),
      fila({ entidad: 'envasado', id: 'e2', estado: 'pausado', producto: 'B' }),
      fila({ entidad: 'envasado', id: 'e1', estado: 'activo', producto: 'A' }),
      fila({ entidad: 'fabricacion', id: 'f2', estado: 'pausada', producto: 'Z' }),
      fila({ entidad: 'fabricacion', id: 'f1', estado: 'fabricando', producto: 'M' }),
      fila({ entidad: 'fabricacion', id: 'x1', estado: 'cola' }),
      fila({ entidad: 'fabricacion', id: 'x2', estado: 'en_control' }),
      fila({ entidad: 'fabricacion', id: 'x3', estado: 'para_envasar' }),
      fila({ entidad: 'fabricacion', id: 'x4', estado: 'finalizada' }),
      fila({ entidad: 'envasado', id: 'x5', estado: 'cola' }),
    ]
    expect(ordenesEnMarcha(flujo).map((o) => o.id)).toEqual(['f1', 'f2', 'e1', 'e2', 'fr'])
  })
})

describe('pideCantidad / unidadPorDefecto', () => {
  it('solo envasado y fraccionado piden cantidad', () => {
    expect(pideCantidad(fila({ entidad: 'fabricacion', id: 'a', estado: 'fabricando' }))).toBe(false)
    expect(pideCantidad(fila({ entidad: 'envasado', id: 'a', estado: 'activo' }))).toBe(true)
    expect(pideCantidad(fila({ entidad: 'fraccionado', id: 'a', estado: 'activo' }))).toBe(true)
  })

  it('kg para polvo, L para el resto', () => {
    expect(unidadPorDefecto(fila({ entidad: 'envasado', id: 'a', estado: 'activo', producto_tipo: 'polvo' }))).toBe('kg')
    expect(unidadPorDefecto(fila({ entidad: 'envasado', id: 'a', estado: 'activo', producto_tipo: 'denso' }))).toBe('L')
  })
})

describe('faltanCantidades', () => {
  const env = fila({ entidad: 'envasado', id: 'e1', estado: 'activo', operarias: [op('A'), op('B')] })
  const fab = fila({ entidad: 'fabricacion', id: 'f1', estado: 'fabricando', operarias: [op('A')] })

  it('detecta la operaria sin cantidad en un envasado e ignora fabricaciones', () => {
    const r = faltanCantidades([env, fab], [{ entidad: 'envasado', id: 'e1', empleadoId: 'A', cantidad: 5, unidad: 'L' }])
    expect(r).toEqual([{ entidad: 'envasado', id: 'e1' }])
  })

  it('nada falta si están todas', () => {
    const cs = ['A', 'B'].map((e) => ({ entidad: 'envasado' as const, id: 'e1', empleadoId: e, cantidad: 1, unidad: 'L' as const }))
    expect(faltanCantidades([env, fab], cs)).toEqual([])
  })
})

describe('armarArranque', () => {
  const flujo = [
    fila({ entidad: 'envasado', id: 'e1', estado: 'pausado' }),
    fila({ entidad: 'envasado', id: 'e2', estado: 'pausado' }),
    fila({ entidad: 'fabricacion', id: 'f1', estado: 'finalizada' }),
  ]
  const activas = new Set(['A', 'B'])

  it('estaba pausada no se reanuda; en_curso sí', () => {
    const r = armarArranque(
      [
        { entidad: 'envasado', entidad_id: 'e1', estaba: 'pausada', operarias: ['A'] },
        { entidad: 'envasado', entidad_id: 'e2', estaba: 'en_curso', operarias: ['A'] },
      ],
      flujo,
      activas,
    )
    expect(r.map((x) => x.reanudar)).toEqual([false, true])
    expect(r[1]).toMatchObject({ ref: { entidad: 'envasado', id: 'e2' }, cerrada: false, empleados: ['A'] })
  })

  it('orden finalizada o desaparecida queda cerrada y no se reanuda', () => {
    const r = armarArranque(
      [
        { entidad: 'fabricacion', entidad_id: 'f1', estaba: 'en_curso', operarias: [] },
        { entidad: 'fabricacion', entidad_id: 'nada', estaba: 'en_curso', operarias: [] },
      ],
      flujo,
      activas,
    )
    expect(r.map((x) => [x.cerrada, x.reanudar, x.orden === null])).toEqual([
      [true, false, false],
      [true, false, true],
    ])
  })

  it('operarias vacías dan empleados vacío', () => {
    const [x] = armarArranque([{ entidad: 'envasado', entidad_id: 'e1', estaba: 'en_curso', operarias: [] }], flujo, activas)
    expect(x.empleados).toEqual([])
  })

  it('no premarca a las operarias de anoche que ya no están activas', () => {
    const [x] = armarArranque(
      [{ entidad: 'envasado', entidad_id: 'e2', estaba: 'en_curso', operarias: ['A', 'Z', 'B'] }],
      flujo,
      activas,
    )
    expect(x.empleados).toEqual(['A', 'B'])
  })
})

describe('erroresArranque', () => {
  const nombres = new Map([['A', 'Ana']])
  const est = (entidad: 'fabricacion' | 'envasado' | 'fraccionado', id: string, empleados: string[], extra = {}) => ({
    ref: { entidad, id },
    orden: null,
    cerrada: false,
    reanudar: true,
    empleados,
    ...extra,
  })

  it('orden marcada sin operarias', () => {
    expect(erroresArranque([est('envasado', 'e1', [])], nombres)).toEqual({ 'envasado:e1': 'Elegí al menos una operaria.' })
  })

  it('misma operaria en dos envasados', () => {
    const r = erroresArranque([est('envasado', 'e1', ['A']), est('envasado', 'e2', ['A'])], nombres)
    expect(r['envasado:e2']).toBe('Ana ya está en otro envasado.')
  })

  it('no aplica a fabricación ni a fraccionado', () => {
    const r = erroresArranque(
      [est('fabricacion', 'f1', ['A']), est('fabricacion', 'f2', ['A']), est('fraccionado', 'x1', ['A']), est('fraccionado', 'x2', ['A'])],
      nombres,
    )
    expect(r).toEqual({})
  })

  it('ignora las no marcadas y las cerradas', () => {
    const r = erroresArranque(
      [est('envasado', 'e1', [], { reanudar: false }), est('envasado', 'e2', [], { cerrada: true, reanudar: false })],
      nombres,
    )
    expect(r).toEqual({})
  })
})
