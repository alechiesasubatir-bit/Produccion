import type { Page, Route } from '@playwright/test'

// Simula Supabase (auth, REST y RPC de produccion) para la tablet. Estado en memoria por test.
const UID = '00000000-0000-0000-0000-00000000aaaa'

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}

function sesionFalsa() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: UID, role: 'authenticated', aud: 'authenticated', exp })}.firma`
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'refresh-falso',
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'tablet@prueba.local', app_metadata: {}, user_metadata: {} },
  }
}

export const operarias = [
  { empleado_id: 'E1', nombre: 'Laura Paz', foto_url: null, categoria: 'A', color_avatar: '#db2777', activo: true },
  { empleado_id: 'E2', nombre: 'Rosa Díaz', foto_url: null, categoria: 'A', color_avatar: '#0284c7', activo: true },
]

export async function simularSupabase(page: Page, rol: 'planta' | 'panel' = 'planta') {
  const tarea = {
    entidad: 'fabricacion',
    id: 'F1',
    estado: 'cola',
    producto: 'Lavandina',
    color: '#0284c7',
    tanque_codigo: 'T-01',
    presentacion: null,
    cantidad: null,
    litros: 1200,
    lote: 'L-001',
    descripcion: null,
    operaria_1: null as string | null,
    operaria_2: null,
    listo: true,
    inicio: null as string | null,
    min_efectivos: null as number | null,
    corriendo: false,
    created_at: '2026-10-21T09:00:00Z',
  }
  let abierta = true
  // Estado del panel: un tanque libre y las fabricaciones que se van creando.
  const productos = [{ id: 'p1', nombre: 'Lavandina', color: '#0284c7', tipo: 'liquido', litros_hora_std: null, activo: true }]
  const presentaciones = [{ id: 'pr1', nombre: '5L', litros_equiv: 5, activo: true }]
  const tanque = {
    tanque_id: 't1', codigo: 'T-01', capacidad_l: 2000, orden: 1, estado: 'libre',
    fabricacion_id: null as string | null, producto_id: null as string | null, producto: null as string | null,
    color: null as string | null, litros: null as number | null, litros_restantes: null as number | null,
    envasado_id: null, operaria_id: null, inicio: null,
  }
  const flujo: object[] = []
  const hoy = new Date().toISOString().slice(0, 10)
  const historial = [
    { entidad: 'fabricacion', id: 'H1', estado: 'finalizada', producto: 'Lavandina', color: '#0284c7', tanque_codigo: 'T-01',
      presentacion: null, cantidad: null, litros: 1200, litros_equiv: null, lote: 'L-1', descripcion: null,
      operaria_1: 'E1', operaria_1_nombre: 'Laura Paz', operaria_2: null, operaria_2_nombre: null,
      inicio: `${hoy}T11:00:00Z`, fin: `${hoy}T13:00:00Z`, created_at: `${hoy}T10:00:00Z`,
      min_brutos: 120, min_pausa: 10, min_efectivos: 110, dia: hoy },
    { entidad: 'envasado', id: 'H2', estado: 'finalizado', producto: 'Lavandina', color: '#0284c7', tanque_codigo: 'T-01',
      presentacion: '5L', cantidad: 200, litros: 1000, litros_equiv: 5, lote: 'L-1', descripcion: null,
      operaria_1: 'E2', operaria_1_nombre: 'Rosa Díaz', operaria_2: null, operaria_2_nombre: null,
      inicio: `${hoy}T14:00:00Z`, fin: `${hoy}T15:00:00Z`, created_at: `${hoy}T13:30:00Z`,
      min_brutos: 60, min_pausa: 0, min_efectivos: 60, dia: hoy },
  ]
  const alertas = [
    { id: 'AL1', tipo: 'exceso_9h', entidad: 'fabricacion', entidad_id: 'F9', texto: 'Fabricación de Cloro en T-02 lleva más de 9 horas.',
      creada: new Date().toISOString(), leida: false, pospuesta_hasta: null as string | null },
  ]

  await page.addInitScript((s) => localStorage.setItem('prodcontrol_auth', s), JSON.stringify(sesionFalsa()))
  await page.routeWebSocket(/realtime/, (ws) => ws.close())
  await page.route('**/auth/v1/**', (r: Route) => r.fulfill({ json: sesionFalsa().user }))

  // Edge Function de escaneo: devuelve una hoja de fabricación leída.
  await page.route('**/functions/v1/escanear-hoja', (r: Route) =>
    r.fulfill({ json: { ok: true, datos: { producto: 'LAVANDINA', cantidad: '1,500.000', lote: 'L-900', fecha: '21/10/2026' } } }),
  )

  await page.route('**/rest/v1/**', async (r: Route) => {
    const url = new URL(r.request().url())
    const ruta = url.pathname.replace('/rest/v1/', '')
    const metodo = r.request().method()
    if (ruta === 'perfiles') return r.fulfill({ json: { rol: 'sin_acceso', rol_produccion: rol, activo: true } })
    if (ruta === 'v_flujo') return r.fulfill({ json: flujo })
    if (ruta === 'v_tanque_estado') return r.fulfill({ json: [tanque] })
    if (ruta === 'productos' && metodo === 'GET') return r.fulfill({ json: productos })
    if (ruta === 'presentaciones' && metodo === 'GET') return r.fulfill({ json: presentaciones })
    if (ruta === 'tanques' && metodo === 'GET') return r.fulfill({ json: [{ id: 't1', codigo: 'T-01', capacidad_l: 2000, orden: 1, activo: true }] })
    if (ruta === 'eventos') return r.fulfill({ json: [] })
    if (ruta === 'v_historial') return r.fulfill({ json: historial })
    if (ruta === 'v_tiempos_estandar') return r.fulfill({ json: [] })
    if (ruta === 'alertas' && metodo === 'GET') return r.fulfill({ json: alertas })
    if (ruta === 'alertas' && metodo === 'PATCH') {
      Object.assign(alertas[0], r.request().postDataJSON())
      return r.fulfill({ status: 204, body: '' })
    }
    if (ruta === 'envasados' && metodo === 'GET') return r.fulfill({ json: [] })
    if (ruta === 'fabricaciones' && metodo === 'POST') {
      const d = r.request().postDataJSON()
      const prod = productos.find((p) => p.id === d.producto_id)
      flujo.push({
        entidad: 'fabricacion', id: 'NF1', estado: 'cola', producto: prod?.nombre ?? null, color: prod?.color ?? null,
        tanque_codigo: 'T-01', presentacion: null, cantidad: null, litros: d.litros, lote: d.lote, descripcion: null,
        operaria_1: d.operaria_id, operaria_2: null, listo: true, inicio: null, min_efectivos: null, corriendo: false,
        created_at: new Date().toISOString(), fin: null, fabricacion_id: null, litros_restantes: d.litros,
      })
      Object.assign(tanque, { estado: 'cola', fabricacion_id: 'NF1', producto_id: d.producto_id, producto: prod?.nombre, color: prod?.color, litros: d.litros, litros_restantes: d.litros })
      return r.fulfill({ status: 201, body: '' })
    }
    if (ruta === 'v_operarias') return r.fulfill({ json: operarias })
    if (ruta === 'v_tareas') return r.fulfill({ json: abierta ? [tarea] : [] })
    if (ruta === 'rpc/verificar_pin') {
      const { p_pin } = r.request().postDataJSON()
      return r.fulfill({ json: p_pin === '1234' ? { ok: true } : { ok: false, codigo: 'PIN_INCORRECTO' } })
    }
    if (ruta === 'rpc/accion') {
      const { p_accion, p_empleado_id } = r.request().postDataJSON()
      if (p_accion === 'iniciar') {
        Object.assign(tarea, { estado: 'fabricando', operaria_1: p_empleado_id, corriendo: true, min_efectivos: 0, inicio: new Date().toISOString() })
      }
      if (p_accion === 'finalizar') abierta = false
      return r.fulfill({ json: { ok: true, fabricacion_cerrada: false } })
    }
    return r.fulfill({ status: 404, json: { message: `sin mock: ${ruta}` } })
  })
}
