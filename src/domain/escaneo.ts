// Normalización de lo que devuelve el escaneo de la hoja Macrosoft.

export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Macrosoft escribe coma = miles y punto = decimal: "1,000.000" = 1000. Nunca ×1000. */
export function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const limpio = v.replace(/,/g, '').trim()
  if (!limpio || !/^-?\d+(\.\d+)?$/.test(limpio)) return null
  return Number(limpio)
}

/** Exacto (normalizado); si no, el primero cuyo nombre esté contenido en lo leído o viceversa. */
export function buscarEnCatalogo<T extends { nombre: string }>(nombre: string, catalogo: T[]): T | null {
  const n = normalizarNombre(nombre)
  if (!n) return null
  return (
    catalogo.find((c) => normalizarNombre(c.nombre) === n) ??
    catalogo.find((c) => {
      const cn = normalizarNombre(c.nombre)
      return n.includes(cn) || cn.includes(n)
    }) ??
    null
  )
}

// Equivalencias de la app vieja: 1/2 kg=500g, 1/4 kg=250g, 1 lt=1L, x 5 L=5L.
export function normalizarPresentacion(s: string): string {
  const t = s.toLowerCase().replace(/^x\s*/, '').trim()
  if (/^1\/2\s*kg$/.test(t)) return '500g'
  if (/^1\/4\s*kg$/.test(t)) return '250g'
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(l|lt|lts|litros?|kg|g|gr|ml|cc)$/)
  if (!m) return s.trim()
  const unidad = { l: 'L', lt: 'L', lts: 'L', litro: 'L', litros: 'L', kg: 'kg', g: 'g', gr: 'g', ml: 'ml', cc: 'ml' }[m[2]] ?? m[2]
  return `${m[1].replace(',', '.')}${unidad}`
}

type Presentacion = { nombre: string; cantidad: unknown }
export type DatosEscaneo = {
  producto?: string
  granel?: string
  cantidad?: unknown
  lote?: string
  fecha?: string
  presentaciones?: Presentacion[]
}
export type CatalogosEscaneo = {
  productos: { id: string; nombre: string }[]
  presentaciones: { id: string; nombre: string }[]
  tanquesEnvasar: { fabricacion_id: string; producto: string; codigo: string }[]
}

// Pasa lo leído de la hoja a campos del formulario. Lo que no se encuentra en los catálogos no se
// precarga: va a `avisos` para que la encargada lo complete a mano.
export function aplicarEscaneo(
  tipo: 'fabricacion' | 'envasado' | 'fraccionado',
  d: DatosEscaneo,
  cat: CatalogosEscaneo,
): { campos: Record<string, string | number>; avisos: string[] } {
  const campos: Record<string, string | number> = {}
  const avisos: string[] = []

  const producto = (nombre: string | undefined) => {
    if (!nombre) return
    const p = buscarEnCatalogo(nombre, cat.productos)
    if (p) campos.producto_id = p.id
    else avisos.push(`No encontré «${nombre}» en productos.`)
  }
  const primeraPresentacion = (lista: Presentacion[] | undefined) => {
    if (!lista?.length) return
    if (lista.length > 1) avisos.push(`La hoja trae ${lista.length} presentaciones; cargá una orden por cada una.`)
    const leida = lista[0]
    const p =
      buscarEnCatalogo(normalizarPresentacion(leida.nombre), cat.presentaciones) ?? buscarEnCatalogo(leida.nombre, cat.presentaciones)
    if (p) campos.presentacion_id = p.id
    else avisos.push(`No encontré «${leida.nombre}» en presentaciones.`)
    const n = aNumero(leida.cantidad)
    if (n !== null) campos.cantidad = Math.round(n)
  }

  if (tipo === 'fabricacion') {
    producto(d.producto)
    const litros = aNumero(d.cantidad)
    if (litros !== null) campos.litros = litros
  } else if (tipo === 'envasado') {
    if (d.granel) {
      const t = buscarEnCatalogo(
        d.granel,
        cat.tanquesEnvasar.map((x) => ({ ...x, nombre: x.producto })),
      )
      if (t) campos.fabricacion_id = t.fabricacion_id
      else avisos.push(`No hay un tanque listo para envasar «${d.granel}».`)
    }
    primeraPresentacion(d.presentaciones)
  } else {
    producto(d.producto)
    if (d.producto) campos.descripcion = d.producto
    primeraPresentacion(d.presentaciones)
  }
  if (tipo !== 'envasado' && d.lote) campos.lote = d.lote
  return { campos, avisos }
}
