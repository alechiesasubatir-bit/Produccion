// `fetch` falso para el cliente de Supabase en la DEMO: responde el mismo contrato HTTP de PostgREST
// (y de rpc / functions) a partir del simulador en memoria. Ninguna request sale del navegador.
import type { Accion, Entidad } from '../domain/acciones'
import type { Fila, Simulador } from './simulador'

const JSON_H = { 'Content-Type': 'application/json' }
const responder = (cuerpo: unknown, status = 200) =>
  new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status, headers: JSON_H })

const IGNORAR = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'])

// Filtros PostgREST que usa la app: eq, neq, in, is.
function filtrar(filas: Fila[], params: URLSearchParams): Fila[] {
  let r = filas
  for (const [col, expr] of params) {
    if (IGNORAR.has(col)) continue
    const punto = expr.indexOf('.')
    const op = expr.slice(0, punto)
    const valor = expr.slice(punto + 1)
    const texto = (f: Fila) => (f[col] === null || f[col] === undefined ? 'null' : String(f[col]))
    if (op === 'eq') r = r.filter((f) => texto(f) === valor)
    else if (op === 'neq') r = r.filter((f) => texto(f) !== valor)
    else if (op === 'is') r = r.filter((f) => texto(f) === valor)
    else if (op === 'in') {
      const lista = new Set(valor.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')))
      r = r.filter((f) => lista.has(texto(f)))
    }
  }
  return r
}

function ordenar(filas: Fila[], order: string | null): Fila[] {
  if (!order) return filas
  const [col, dir] = order.split(',')[0].split('.')
  const signo = dir === 'desc' ? -1 : 1
  return [...filas].sort((a, b) => {
    const x = a[col]
    const y = b[col]
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * signo
    return String(x ?? '').localeCompare(String(y ?? '')) * signo
  })
}

async function cuerpo(init?: RequestInit): Promise<unknown> {
  if (!init?.body) return null
  return JSON.parse(typeof init.body === 'string' ? init.body : await new Response(init.body).text())
}

export function crearFetchDemo(sim: Simulador, onCambio: () => void): typeof fetch {
  return async (entrada, init) => {
    const pedido = entrada instanceof Request ? entrada : null
    const url = new URL(pedido ? pedido.url : String(entrada))
    const metodo = (init?.method ?? pedido?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? pedido?.headers)

    if (url.pathname.startsWith('/functions/v1/')) {
      return responder({ ok: false, error: 'En la demo no se leen hojas: cargá la orden a mano.' })
    }
    if (url.pathname.startsWith('/auth/v1/')) return responder({}, 200)
    if (!url.pathname.startsWith('/rest/v1/')) return responder({ message: 'demo' }, 404)

    const ruta = url.pathname.slice('/rest/v1/'.length)

    if (ruta.startsWith('rpc/')) {
      const args = ((await cuerpo(init)) ?? {}) as Record<string, string>
      if (ruta === 'rpc/accion') {
        const r = sim.accion(args.p_entidad as Entidad, args.p_id, args.p_accion as Accion, args.p_empleado_id ?? null)
        if (r.ok) onCambio()
        return responder(r)
      }
      return responder(ruta === 'rpc/verificar_pin' ? { ok: true } : true)
    }

    if (metodo === 'GET' || metodo === 'HEAD') {
      let filas = ordenar(filtrar(sim.consultar(ruta), url.searchParams), url.searchParams.get('order'))
      const desde = Number(url.searchParams.get('offset') ?? 0)
      const limite = url.searchParams.get('limit')
      filas = filas.slice(desde, limite === null ? undefined : desde + Number(limite))
      if ((headers.get('Accept') ?? '').includes('vnd.pgrst.object')) {
        return filas.length ? responder(filas[0]) : responder({ message: 'sin filas', code: 'PGRST116' }, 406)
      }
      return responder(filas)
    }

    if (metodo === 'POST') {
      const datos = await cuerpo(init)
      try {
        for (const d of Array.isArray(datos) ? datos : [datos]) sim.insertar(ruta, d as Fila)
      } catch (e) {
        return responder({ code: '23505', message: (e as Error).message, details: null, hint: null }, 409)
      }
      onCambio()
      return responder(null, 201)
    }

    // PATCH / DELETE (alertas, catálogos): en la demo no hay nada que guardar.
    return responder(null, 204)
  }
}
