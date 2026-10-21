// ProdControl · Edge Function escanear-hoja
// Lee la foto de una hoja "Movimientos de Producción" de Macrosoft con Claude y devuelve los
// datos como JSON validado. La clave vive en el secreto ANTHROPIC_API_KEY (nunca en el front).
// Solo la encargada (panel) puede usarla.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.137.0'
import { betaZodOutputFormat } from 'npm:@anthropic-ai/sdk@^0.137.0/helpers/beta/zod'
import { createClient } from 'npm:@supabase/supabase-js@^2'
import { z } from 'npm:zod@^4.6.7'

type Tipo = 'fabricacion' | 'envasado' | 'fraccionado'

const presentaciones = z.array(z.object({ nombre: z.string(), cantidad: z.number() }))

const ESQUEMAS = {
  fabricacion: z.object({ lote: z.string(), fecha: z.string(), producto: z.string(), cantidad: z.number() }),
  envasado: z.object({ fecha: z.string(), granel: z.string(), presentaciones }),
  fraccionado: z.object({ lote: z.string(), fecha: z.string(), producto: z.string(), presentaciones }),
}

// Prompts de la app vieja (ProdControl en Firebase). El formato JSON lo garantiza el esquema.
const PROMPTS: Record<Tipo, string> = {
  fabricacion:
    'Esta es una hoja Movimientos de Produccion - Fabrica Produccion de Macrosoft. IMPORTANTE: coma=miles punto=decimal. ' +
    '1,000.000=1000. 3,000.000=3000. NUNCA multipliques por 1000. Extraé: lote (numero despues de LOTE N), fecha (DD/MM/YYYY), ' +
    'producto granel (fila SIN parentesis cuyo codigo empieza con letra F seguido de numeros), cantidad entera del granel. ' +
    'Filas con parentesis son materias primas - ignoralas.',
  envasado:
    'Esta es una hoja Movimientos de Produccion - Fabrica Envasado de Macrosoft. IMPORTANTE: coma=miles punto=decimal. 800.000=800. ' +
    'Equivalencias: 1/2 kg=500g, 1/4 kg=250g, 1 lt=1L, x 5 L=5 litros. Extraé: fecha (DD/MM/YYYY), granel (codigo F+numeros con ' +
    'cantidad entre parentesis - solo el nombre), presentaciones finales (filas SIN parentesis - NO etiquetas ni tapas ni botellas).',
  fraccionado:
    'Esta es una hoja de Fraccionado (Movimiento de Produccion Macrosoft). coma=miles, punto=decimal. Equivalencias: 1/2 kg=500g, ' +
    '1/4 kg=250g, 1 lt=1L. Extrae: lote (numero despues de LOTE N o LOT), fecha (DD/MM/YYYY), nombre exacto del producto fraccionado ' +
    '(el articulo principal sin parentesis), presentaciones con cantidades.',
}

const MAX_IMAGEN = 2_000_000 // base64; el front la reduce a ≤ 800 px JPEG 0.6 (~100-300 KB)

function cors(origen: string | null): Record<string, string> {
  const permitido =
    origen && (origen === 'https://alechiesasubatir-bit.github.io' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen))
  return {
    'Access-Control-Allow-Origin': permitido ? origen : 'https://alechiesasubatir-bit.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

Deno.serve(async (req) => {
  const encabezados = cors(req.headers.get('Origin'))
  const responder = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...encabezados, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: encabezados })
  if (req.method !== 'POST') return responder({ ok: false, error: 'Método no permitido.' }, 405)

  // Solo panel: es_panel() con el JWT de quien llama (verify_jwt ya validó la firma).
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const rol = await supabase.schema('produccion').rpc('es_panel')
  if (rol.error || rol.data !== true) return responder({ ok: false, error: 'No tenés permiso para escanear hojas.' }, 403)

  let tipo: Tipo
  let imagen: string
  try {
    const cuerpo = await req.json()
    tipo = cuerpo.tipo
    imagen = cuerpo.imagen
  } catch {
    return responder({ ok: false, error: 'Pedido inválido.' }, 400)
  }
  if (!(tipo in ESQUEMAS) || typeof imagen !== 'string' || !imagen || imagen.length > MAX_IMAGEN) {
    return responder({ ok: false, error: 'Falta el tipo o la imagen (o es demasiado grande).' }, 400)
  }

  try {
    const anthropic = new Anthropic() // ANTHROPIC_API_KEY del secreto de la función
    const r = await anthropic.beta.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // si el modelo rechaza la imagen, el servidor reintenta con otro
      output_config: { format: betaZodOutputFormat(ESQUEMAS[tipo]) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagen } },
            { type: 'text', text: PROMPTS[tipo] },
          ],
        },
      ],
    })
    if (r.stop_reason === 'refusal') return responder({ ok: false, error: 'No se pudo leer esta hoja. Cargala a mano.' })
    if (!r.parsed_output) return responder({ ok: false, error: 'La lectura no trajo datos válidos. Cargala a mano.' })
    return responder({ ok: true, datos: r.parsed_output })
  } catch (e) {
    const detalle = e instanceof Anthropic.APIError ? `${e.status ?? ''} ${e.message}` : String(e)
    console.error('escanear-hoja', detalle)
    return responder({ ok: false, error: 'El servicio de lectura no respondió. Probá de nuevo o cargala a mano.' }, 502)
  }
})
