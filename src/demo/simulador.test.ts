import { describe, expect, it } from 'vitest'
import { columnaFlujo, type FilaFlujo } from '../domain/flujo'
import { TANQUES } from './catalogo'
import { crearSimulador } from './simulador'

const INICIO = Date.parse('2026-10-21T09:00:00-03:00')
type Tanque = { tanque_id: string; codigo: string; estado: string; fabricacion_id: string | null; litros: number | null; litros_restantes: number | null }

const tanques = (s: ReturnType<typeof crearSimulador>) => s.consultar('v_tanque_estado') as Tanque[]
const flujo = (s: ReturnType<typeof crearSimulador>) => s.consultar('v_flujo') as FilaFlujo[]

const CONTROL_OK = {
  ph: 7.2, densidad: 1.02, perfumeOk: true, perfumeComentario: null, visualOk: true, visualComentario: null,
  observaciones: null, resultado: 'aprobado', fabricacionId: '',
}

describe('simulador de la demo', () => {
  it('arranca con casi todos los tanques en producción y todas las columnas del flujo con algo', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 7 })
    const ocupados = tanques(s).filter((t) => t.estado !== 'libre')
    expect(tanques(s)).toHaveLength(TANQUES.length)
    expect(ocupados.length).toBeGreaterThanOrEqual(TANQUES.length - 3)
    const columnas = new Set(flujo(s).map(columnaFlujo))
    for (const c of ['cola', 'fabricando', 'para_envasar', 'envasando', 'fraccionado', 'terminadas']) {
      expect(columnas, c).toContain(c)
    }
  })

  it('con la misma semilla da exactamente lo mismo', () => {
    const a = crearSimulador({ inicio: INICIO, semilla: 3 })
    const b = crearSimulador({ inicio: INICIO, semilla: 3 })
    a.avanzar(90)
    b.avanzar(90)
    expect(flujo(a)).toEqual(flujo(b))
  })

  it('el reloj simulado avanza un minuto por minuto simulado', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 1, calentar: 0 })
    s.avanzar(30)
    expect(s.ahora() - INICIO).toBe(30 * 60_000)
  })

  it('una fabricación recorre cola → fabricando → para envasar → envasado → finalizada y libera el tanque', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 11, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt1', producto_id: 'dp1', litros: 400, lote: 'L-1' })
    const id = flujo(s).find((f) => f.lote === 'L-1')!.id
    expect(s.accion('fabricacion', id, 'iniciar')).toMatchObject({ ok: true })
    s.avanzar(25) // 400 L a 20 L/min = 20 min
    expect(flujo(s).find((f) => f.id === id)?.estado).toBe('en_control')
    expect(tanques(s).find((t) => t.tanque_id === 'dt1')?.estado).toBe('en_control')
    expect(s.registrarControl({ ...CONTROL_OK, fabricacionId: id })).toEqual({ ok: true, intento: 1 })
    expect(flujo(s).find((f) => f.id === id)?.estado).toBe('para_envasar')
    s.insertar('envasados', { fabricacion_id: id, presentacion_id: 'dr4', cantidad: 80 }) // 80 × 5 L = 400 L
    const env = flujo(s).find((f) => f.entidad === 'envasado' && f.fabricacion_id === id)!
    expect(tanques(s).find((t) => t.tanque_id === 'dt1')?.estado).toBe('cola_env')
    s.accion('envasado', env.id, 'iniciar')
    expect(tanques(s).find((t) => t.tanque_id === 'dt1')?.estado).toBe('envasando')
    s.avanzar(30)
    expect(flujo(s).find((f) => f.id === env.id)?.estado).toBe('finalizado')
    expect(flujo(s).find((f) => f.id === id)?.estado).toBe('finalizada')
    expect(tanques(s).find((t) => t.tanque_id === 'dt1')?.estado).toBe('libre')
  })

  it('el tanque baja mientras se envasa', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 11, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt2', producto_id: 'dp2', litros: 1000, lote: 'L-2' })
    const id = flujo(s).find((f) => f.lote === 'L-2')!.id
    s.accion('fabricacion', id, 'iniciar')
    s.avanzar(55)
    s.insertar('envasados', { fabricacion_id: id, presentacion_id: 'dr4', cantidad: 200 })
    const env = flujo(s).find((f) => f.entidad === 'envasado')!
    s.accion('envasado', env.id, 'iniciar')
    s.avanzar(10)
    const t = tanques(s).find((x) => x.tanque_id === 'dt2')!
    expect(t.litros).toBe(1000)
    expect(t.litros_restantes).toBeLessThan(1000)
    expect(t.litros_restantes).toBeGreaterThan(0)
  })

  it('pausar detiene el avance y reanudar lo continúa; las acciones inválidas se rechazan', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 5, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt3', producto_id: 'dp3', litros: 600, lote: 'L-3' })
    const id = flujo(s).find((f) => f.lote === 'L-3')!.id
    expect(s.accion('fabricacion', id, 'pausar')).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
    s.accion('fabricacion', id, 'iniciar')
    s.avanzar(5)
    s.accion('fabricacion', id, 'pausar')
    s.avanzar(60)
    const pausada = flujo(s).find((f) => f.id === id)!
    expect(pausada.estado).toBe('pausada')
    expect(pausada.min_efectivos).toBe(5)
    s.accion('fabricacion', id, 'reanudar')
    s.avanzar(3)
    expect(flujo(s).find((f) => f.id === id)!.min_efectivos).toBe(8)
    expect(s.accion('fabricacion', 'no-existe', 'iniciar')).toMatchObject({ ok: false, codigo: 'NO_ENCONTRADO' })
  })

  it('no deja abrir dos fabricaciones en el mismo tanque', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 5, calentar: 0, autonomo: false })
    s.insertar('fabricaciones', { tanque_id: 'dt4', producto_id: 'dp4', litros: 500, lote: 'L-4' })
    expect(() => s.insertar('fabricaciones', { tanque_id: 'dt4', producto_id: 'dp4', litros: 500, lote: 'L-5' })).toThrow(
      /fabricaciones_tanque_abierta_uk/,
    )
  })

  it('solo, la planta no para: con el tiempo se terminan tareas y se arrancan nuevas', () => {
    const s = crearSimulador({ inicio: INICIO, semilla: 9 })
    const antes = new Set(flujo(s).map((f) => f.id))
    s.avanzar(240)
    const nuevas = flujo(s).filter((f) => !antes.has(f.id))
    expect(nuevas.length).toBeGreaterThan(3)
    expect(flujo(s).some((f) => f.corriendo)).toBe(true)
  })

  describe('varias operarias por orden', () => {
    type Sim = ReturnType<typeof crearSimulador>
    type Part = { id: string; entidad: string; entidad_id: string; empleado_id: string; hasta: string | null; cantidad: number | null; unidad: string | null; cantidad_corregida: number | null }
    type Op = { empleado_id: string; nombre: string }
    type TareaFila = { id: string; operarias: Op[]; etiqueta: string | null; vencimiento: string | null }
    const nuevo = () => crearSimulador({ inicio: INICIO, semilla: 21, calentar: 0, autonomo: false })
    const partes = (s: Sim) => s.consultar('participaciones') as Part[]
    const tarea = (s: Sim, id: string) => (s.consultar('v_tareas') as TareaFila[]).find((t) => t.id === id)!
    const chico = (s: Sim, extra: Record<string, unknown> = {}) => {
      s.insertar('fabricaciones', { tanque_id: 'dt1', producto_id: 'dp1', litros: 100, lote: 'L-1' })
      const fab = flujo(s)[0].id
      s.accion('fabricacion', fab, 'iniciar', 'do1')
      s.avanzar(10) // 100 L a 20 L/min = 5 min
      s.registrarControl({ ...CONTROL_OK, fabricacionId: fab })
      s.insertar('envasados', { fabricacion_id: fab, presentacion_id: 'dr4', cantidad: 20, ...extra })
      const env = flujo(s).find((f) => f.entidad === 'envasado')!.id
      return { fab, env }
    }

    it('iniciar abre la participación de quien inicia; sumarse suma a otra y repetir da YA_PARTICIPA', () => {
      const s = nuevo()
      const { env } = chico(s)
      expect(s.accion('envasado', env, 'iniciar', 'do1')).toMatchObject({ ok: true })
      expect(tarea(s, env).operarias.map((o) => o.empleado_id)).toEqual(['do1'])
      expect(s.accion('envasado', env, 'sumarse', 'do2')).toMatchObject({ ok: true })
      expect(tarea(s, env).operarias.map((o) => o.empleado_id)).toEqual(['do1', 'do2'])
      expect(tarea(s, env).operarias[1].nombre).toBe('Carla Pereira')
      expect(s.accion('envasado', env, 'sumarse', 'do2')).toMatchObject({ ok: false, codigo: 'YA_PARTICIPA' })
    })

    it('sumarse solo en órdenes en curso y con operaria', () => {
      const s = nuevo()
      const { env } = chico(s)
      expect(s.accion('envasado', env, 'sumarse', 'do2')).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
      s.accion('envasado', env, 'iniciar', 'do1')
      expect(s.accion('envasado', env, 'sumarse')).toMatchObject({ ok: false, codigo: 'NO_AUTORIZADO' })
    })

    it('salir exige cantidad declarada, rechaza a la última y a quien no está', () => {
      const s = nuevo()
      const { env } = chico(s)
      s.accion('envasado', env, 'iniciar', 'do1')
      s.accion('envasado', env, 'sumarse', 'do2')
      expect(s.accion('envasado', env, 'salir', 'do3')).toMatchObject({ ok: false, codigo: 'NO_PARTICIPA' })
      expect(s.accion('envasado', env, 'salir', 'do2')).toMatchObject({ ok: false, codigo: 'CANTIDAD_REQUERIDA' })
      expect(s.accion('envasado', env, 'salir', 'do2', [{ empleado_id: 'do2', cantidad: 0, unidad: 'L' }])).toMatchObject({ ok: false, codigo: 'CANTIDAD_REQUERIDA' })
      expect(tarea(s, env).operarias).toHaveLength(2) // nada quedó a medias
      expect(s.accion('envasado', env, 'salir', 'do2', [{ empleado_id: 'do2', cantidad: 30, unidad: 'L' }])).toMatchObject({ ok: true })
      expect(tarea(s, env).operarias.map((o) => o.empleado_id)).toEqual(['do1'])
      expect(partes(s).find((p) => p.empleado_id === 'do2')).toMatchObject({ hasta: expect.any(String), cantidad: 30, unidad: 'L' })
      expect(s.accion('envasado', env, 'salir', 'do1', [{ empleado_id: 'do1', cantidad: 5, unidad: 'L' }])).toMatchObject({ ok: false, codigo: 'ULTIMA_OPERARIA' })
    })

    it('finalizar un envasado desde la tablet pide la cantidad de cada operaria y cierra todas las participaciones', () => {
      const s = nuevo()
      const { env, fab } = chico(s)
      s.accion('envasado', env, 'iniciar', 'do1')
      s.accion('envasado', env, 'sumarse', 'do2')
      expect(s.accion('envasado', env, 'finalizar', 'do1', [{ empleado_id: 'do1', cantidad: 60, unidad: 'L' }])).toMatchObject({ ok: false, codigo: 'CANTIDAD_REQUERIDA' })
      const r = s.accion('envasado', env, 'finalizar', 'do1', [
        { empleado_id: 'do1', cantidad: 60, unidad: 'L' },
        { empleado_id: 'do2', cantidad: 40, unidad: 'L' },
      ])
      expect(r).toMatchObject({ ok: true, fabricacion_cerrada: true })
      expect(partes(s).filter((p) => p.entidad_id === env).map((p) => [p.empleado_id, p.cantidad, p.hasta !== null])).toEqual([
        ['do1', 60, true],
        ['do2', 40, true],
      ])
      expect(flujo(s).find((f) => f.id === fab)?.estado).toBe('finalizada')
    })

    it('desde el panel (sin operaria) finalizar no exige cantidades', () => {
      const s = nuevo()
      const { env } = chico(s)
      s.accion('envasado', env, 'iniciar', 'do1')
      expect(s.accion('envasado', env, 'finalizar')).toMatchObject({ ok: true })
      expect(partes(s).find((p) => p.entidad_id === env)).toMatchObject({ empleado_id: 'do1', cantidad: null })
    })

    it('desde la tablet solo pausa/reanuda quien está en la orden', () => {
      const s = nuevo()
      const { env } = chico(s)
      s.accion('envasado', env, 'iniciar', 'do1')
      expect(s.accion('envasado', env, 'pausar', 'do2')).toMatchObject({ ok: false, codigo: 'NO_PARTICIPA' })
      expect(s.accion('envasado', env, 'pausar', 'do1')).toMatchObject({ ok: true })
    })

    it('OPERARIA_OCUPADA solo si está en otro envasado activo (los pausados no bloquean)', () => {
      const s = nuevo()
      const { env, fab } = chico(s, { cantidad: 10 })
      s.insertar('envasados', { fabricacion_id: fab, presentacion_id: 'dr4', cantidad: 10 })
      const otro = flujo(s).filter((f) => f.entidad === 'envasado').find((f) => f.id !== env)!.id
      s.accion('envasado', env, 'iniciar', 'do1')
      expect(s.accion('envasado', otro, 'iniciar', 'do1')).toMatchObject({ ok: false, codigo: 'OPERARIA_OCUPADA' })
      s.accion('envasado', env, 'pausar', 'do1')
      expect(s.accion('envasado', otro, 'iniciar', 'do1')).toMatchObject({ ok: true })
      // reanudar el pausado: do1 está activa en el otro
      expect(s.accion('envasado', env, 'reanudar', 'do1')).toMatchObject({ ok: false, codigo: 'OPERARIA_OCUPADA' })
    })

    it('corregir_cantidad solo sobre tramos cerrados; guarda quién y cuándo y deja el evento', () => {
      const s = nuevo()
      const { env } = chico(s)
      s.accion('envasado', env, 'iniciar', 'do1')
      s.accion('envasado', env, 'sumarse', 'do2')
      const abierta = partes(s).find((p) => p.empleado_id === 'do2')!
      expect(s.corregirCantidad(abierta.id, 50)).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
      s.accion('envasado', env, 'salir', 'do2', [{ empleado_id: 'do2', cantidad: 30, unidad: 'L' }])
      expect(s.corregirCantidad(abierta.id, 0)).toMatchObject({ ok: false, codigo: 'CANTIDAD_REQUERIDA' })
      expect(s.corregirCantidad('nada', 5)).toMatchObject({ ok: false, codigo: 'NO_ENCONTRADO' })
      expect(s.corregirCantidad(abierta.id, 45, 'kg')).toMatchObject({ ok: true })
      expect(partes(s).find((p) => p.id === abierta.id)).toMatchObject({ cantidad: 30, cantidad_corregida: 45, unidad: 'kg', corregida_por: expect.any(String) })
      expect(s.consultar('eventos').some((e) => e.accion === 'corregir' && e.entidad_id === env)).toBe(true)
    })

    it('set_vencimiento: guarda la fecha en la fabricación y rechaza lo cerrado, lo inexistente y a quien no está', () => {
      const s = nuevo()
      s.insertar('fabricaciones', { tanque_id: 'dt2', producto_id: 'dp2', litros: 300, lote: 'L-9' })
      const id = flujo(s)[0].id
      expect(s.setVencimiento(id, null)).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
      expect(s.setVencimiento('nada', '2028-01-01')).toMatchObject({ ok: false, codigo: 'NO_ENCONTRADO' })
      expect(s.setVencimiento(id, '2028-01-01')).toMatchObject({ ok: true })
      expect(tarea(s, id).vencimiento).toBe('2028-01-01')
      s.accion('fabricacion', id, 'iniciar', 'do1')
      expect(s.setVencimiento(id, '2028-02-02', 'do2')).toMatchObject({ ok: false, codigo: 'NO_PARTICIPA' })
      expect(s.setVencimiento(id, '2028-02-02', 'do1')).toMatchObject({ ok: true })
      expect(s.consultar('eventos').filter((e) => e.accion === 'editar')).toHaveLength(2)
      s.accion('fabricacion', id, 'cancelar')
      expect(s.setVencimiento(id, '2029-01-01')).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
    })

    it('las etiquetas son un catálogo inventado y llegan a la tarea', () => {
      const s = nuevo()
      const etiquetas = s.consultar('etiquetas') as { id: string; nombre: string; activo: boolean }[]
      expect(etiquetas.map((e) => e.nombre)).toEqual(['Etiqueta Demo A', 'Etiqueta Demo B'])
      const { env } = chico(s, { etiqueta_id: etiquetas[1].id })
      expect(tarea(s, env).etiqueta).toBe('Etiqueta Demo B')
    })

    it('el historial trae las participaciones con su cantidad y minutos', () => {
      const s = nuevo()
      const { env } = chico(s, { cantidad: 100 }) // 500 L: tarda unos 14 min
      s.accion('envasado', env, 'iniciar', 'do1')
      s.avanzar(4)
      s.accion('envasado', env, 'sumarse', 'do2')
      s.avanzar(2)
      s.accion('envasado', env, 'salir', 'do2', [{ empleado_id: 'do2', cantidad: 12, unidad: 'L' }])
      type H = { id: string; participaciones: { empleado_id: string; cantidad: number | null; minutos: number; hasta: string | null }[] }
      const h = (s.consultar('v_historial') as H[]).find((x) => x.id === env)!
      expect(h.participaciones.map((p) => [p.empleado_id, p.cantidad, p.hasta !== null])).toEqual([
        ['do1', null, false],
        ['do2', 12, true],
      ])
      expect(h.participaciones[1].minutos).toBe(2)
    })

    it('solas, las simuladas se suman a órdenes en curso y salen declarando una cantidad (misma semilla, mismo resultado)', () => {
      const correr = () => {
        const s = crearSimulador({ inicio: INICIO, semilla: 5 })
        let dos = false
        for (let i = 0; i < 40; i++) {
          s.avanzar(30)
          if ((s.consultar('v_tareas') as TareaFila[]).some((t) => t.operarias.length >= 2)) dos = true
        }
        return { dos, partes: partes(s) }
      }
      const a = correr()
      expect(a.dos).toBe(true)
      expect(a.partes.some((p) => p.hasta !== null && p.cantidad !== null && p.cantidad > 0)).toBe(true)
      expect(correr().partes).toEqual(a.partes)
    })
  })

  describe('control para liberación', () => {
    type Ctl = { intento: number; resultado: string; ph: number | null; densidad: number | null; origen: string; firmado_nombre: string }
    type Ev = { accion: string; entidad_id: string; datos: { intento?: number; motivo?: string } }
    type Sim = ReturnType<typeof crearSimulador>
    const enControl = (producto = 'dp1') => {
      const s = crearSimulador({ inicio: INICIO, semilla: 11, calentar: 0, autonomo: false })
      s.insertar('fabricaciones', { tanque_id: 'dt1', producto_id: producto, litros: 100, lote: 'L-1' })
      const id = flujo(s)[0].id
      s.accion('fabricacion', id, 'iniciar', 'do1')
      expect(s.accion('fabricacion', id, 'finalizar', 'do1')).toMatchObject({ ok: true })
      return { s, id }
    }
    const fila = (s: Sim, id: string) => flujo(s).find((f) => f.id === id) as FilaFlujo & { control_intento: number; control_rechazo: string | null }

    it('finalizar la fabricación la deja en control (tarea visible, intento 1, sin fin)', () => {
      const { s, id } = enControl()
      expect(fila(s, id)).toMatchObject({ estado: 'en_control', control_intento: 1, control_rechazo: null, fin: null })
      const tareas = s.consultar('v_tareas') as { id: string; estado: string; control_intento: number }[]
      expect(tareas.find((t) => t.id === id)).toMatchObject({ estado: 'en_control', control_intento: 1 })
    })

    it('valida como la RPC: firmante, estado y datos', () => {
      const { s, id } = enControl()
      const d = { ...CONTROL_OK, fabricacionId: id }
      expect(s.registrarControl({ ...d, firmante: 'otra' })).toMatchObject({ ok: false, codigo: 'NO_AUTORIZADO' })
      expect(s.registrarControl({ ...d, fabricacionId: 'x' })).toMatchObject({ ok: false, codigo: 'NO_ENCONTRADO' })
      expect(s.registrarControl({ ...d, ph: 15 })).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
      expect(s.registrarControl({ ...d, ph: null })).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
      expect(s.registrarControl({ ...d, densidad: 0 })).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
      expect(s.registrarControl({ ...d, resultado: 'quizás' })).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
      expect(s.registrarControl({ ...d, perfumeOk: false, perfumeComentario: '  ' })).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
      expect(s.registrarControl({ ...d, visualOk: null })).toMatchObject({ ok: false, codigo: 'DATOS_INVALIDOS' })
      expect(s.consultar('controles')).toHaveLength(0)
      expect(s.registrarControl({ ...d, firmante: s.liberadoras()[0].id })).toEqual({ ok: true, intento: 1 })
      expect(s.registrarControl(d)).toMatchObject({ ok: false, codigo: 'TRANSICION_INVALIDA' })
    })

    it('polvo: pH y densidad se guardan como null aunque lleguen', () => {
      const { s, id } = enControl('dp13')
      expect(s.registrarControl({ ...CONTROL_OK, fabricacionId: id, ph: null, densidad: null })).toEqual({ ok: true, intento: 1 })
      expect(s.consultar('controles')[0]).toMatchObject({ ph: null, densidad: null })
    })

    it('aprobado → para envasar; queda firmado (tablet) y el evento lleva intento y motivo', () => {
      const { s, id } = enControl()
      s.registrarControl({ ...CONTROL_OK, fabricacionId: id, firmante: s.liberadoras()[0].id, observaciones: ' todo bien ' })
      expect(fila(s, id).estado).toBe('para_envasar')
      expect(s.consultar('controles')).toEqual([
        expect.objectContaining({ fabricacion_id: id, intento: 1, resultado: 'aprobado', origen: 'tablet', firmado_nombre: s.liberadoras()[0].nombre, observaciones: 'todo bien' }),
      ])
      const ev = (s.consultar('eventos') as Ev[]).filter((e) => e.accion === 'aprobar')
      expect(ev).toEqual([expect.objectContaining({ entidad_id: id, datos: expect.objectContaining({ intento: 1, motivo: 'todo bien' }) })])
    })

    it('rechazado → vuelve a fabricar con el motivo; al terminar otra vez el intento es 2', () => {
      const { s, id } = enControl()
      const r = s.registrarControl({
        ...CONTROL_OK, fabricacionId: id, resultado: 'rechazado', perfumeOk: false, perfumeComentario: 'flojo', visualOk: false, visualComentario: 'turbio', observaciones: 'ajustar',
      })
      expect(r).toEqual({ ok: true, intento: 1 })
      const motivo = 'perfume No OK (flojo); visual No OK (turbio); ajustar'
      expect(fila(s, id)).toMatchObject({ estado: 'fabricando', fin: null, control_intento: 2, control_rechazo: motivo })
      expect((s.consultar('eventos') as Ev[]).find((e) => e.accion === 'rechazar')?.datos.motivo).toBe(motivo)
      s.accion('fabricacion', id, 'finalizar', 'do1')
      expect(fila(s, id)).toMatchObject({ estado: 'en_control', control_intento: 2, control_rechazo: null })
      expect(s.registrarControl({ ...CONTROL_OK, fabricacionId: id })).toEqual({ ok: true, intento: 2 })
      const h = (s.consultar('v_historial') as { id: string; controles: Ctl[] }[]).find((x) => x.id === id)!
      expect(h.controles.map((c) => [c.intento, c.resultado])).toEqual([[1, 'rechazado'], [2, 'aprobado']])
    })

    it('cualquier semilla arranca con al menos una fabricación en control', () => {
      for (let semilla = 1; semilla <= 40; semilla++) {
        const s = crearSimulador({ inicio: INICIO, semilla })
        expect(flujo(s).some((f) => f.estado === 'en_control'), `semilla ${semilla}`).toBe(true)
      }
    })

    it('autónoma: la encargada demo controla sola, aprueba la mayoría y rechaza con motivo (determinista)', () => {
      const correr = () => {
        const s = crearSimulador({ inicio: INICIO, semilla: 21 })
        s.avanzar(24 * 60)
        return s
      }
      const s = correr()
      const cs = s.consultar('controles') as Ctl[]
      expect(cs.length).toBeGreaterThan(10)
      expect(cs.filter((c) => c.resultado === 'aprobado').length / cs.length).toBeGreaterThan(0.6)
      expect(cs.some((c) => c.resultado === 'rechazado')).toBe(true)
      expect(cs.every((c) => c.origen === 'panel' && c.firmado_nombre === 'Encargada Demo')).toBe(true)
      const rechazos = (s.consultar('eventos') as Ev[]).filter((e) => e.accion === 'rechazar')
      expect(rechazos.every((e) => !!e.datos.motivo)).toBe(true)
      expect(correr().consultar('controles')).toEqual(cs)
    })
  })
})
