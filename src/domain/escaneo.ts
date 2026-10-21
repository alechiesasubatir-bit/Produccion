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

export type Coincidencia<T> = { item: T; exacta: boolean } | { ambiguas: T[] } | null

/**
 * Exacta (normalizada) si hay. Si no, entre las parciales (una contiene a la otra) la de nombre
 * más largo, solo si es única; si empatan varias, devuelve las ambiguas para avisar.
 */
export function coincidir<T extends { nombre: string }>(nombre: string, catalogo: T[]): Coincidencia<T> {
  const n = normalizarNombre(nombre)
  if (!n) return null
  const exactas = catalogo.filter((c) => normalizarNombre(c.nombre) === n)
  if (exactas.length === 1) return { item: exactas[0], exacta: true }
  if (exactas.length > 1) return { ambiguas: exactas }
  const parciales = catalogo.filter((c) => {
    const cn = normalizarNombre(c.nombre)
    return cn !== '' && (n.includes(cn) || cn.includes(n))
  })
  if (parciales.length === 0) return null
  const largo = Math.max(...parciales.map((c) => normalizarNombre(c.nombre).length))
  const mejores = parciales.filter((c) => normalizarNombre(c.nombre).length === largo)
  return mejores.length === 1 ? { item: mejores[0], exacta: false } : { ambiguas: mejores }
}

/** El ítem si la coincidencia es única (exacta o parcial); null si no hay o es ambigua. */
export function buscarEnCatalogo<T extends { nombre: string }>(nombre: string, catalogo: T[]): T | null {
  const c = coincidir(nombre, catalogo)
  return c && 'item' in c ? c.item : null
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

  // Coincidencia única → precarga (avisando si fue parcial); ambigua o ausente → aviso.
  const asociar = <T extends { nombre: string }>(leido: string, catalogo: T[], donde: string): T | null => {
    const c = coincidir(leido, catalogo)
    if (!c) {
      avisos.push(`No encontré «${leido}» en ${donde}.`)
      return null
    }
    if ('ambiguas' in c) {
      avisos.push(`«${leido}» coincide con varios ${donde} (${c.ambiguas.map((x) => x.nombre).join(', ')}); elegí cuál.`)
      return null
    }
    if (!c.exacta) avisos.push(`«${leido}» se asoció a «${c.item.nombre}». Revisalo.`)
    return c.item
  }
  const producto = (nombre: string | undefined) => {
    if (!nombre) return
    const p = asociar(nombre, cat.productos, 'productos')
    if (p) campos.producto_id = p.id
  }
  const primeraPresentacion = (lista: Presentacion[] | undefined) => {
    if (!lista?.length) return
    if (lista.length > 1) avisos.push(`La hoja trae ${lista.length} presentaciones; cargá una orden por cada una.`)
    const leida = lista[0]
    // Primero con la equivalencia de la app vieja ("x 5 L" → "5L"), después tal cual.
    const exacta = buscarEnCatalogo(normalizarPresentacion(leida.nombre), cat.presentaciones)
    const p = exacta ?? asociar(leida.nombre, cat.presentaciones, 'presentaciones')
    if (p) campos.presentacion_id = p.id
    const n = aNumero(leida.cantidad)
    if (n !== null) campos.cantidad = Math.round(n)
  }

  if (tipo === 'fabricacion') {
    producto(d.producto)
    const litros = aNumero(d.cantidad)
    if (litros !== null) campos.litros = litros
  } else if (tipo === 'envasado') {
    if (d.granel) {
      const c = coincidir(
        d.granel,
        cat.tanquesEnvasar.map((x) => ({ ...x, nombre: x.producto })),
      )
      if (!c) avisos.push(`No hay un tanque listo para envasar «${d.granel}».`)
      else if ('ambiguas' in c) {
        avisos.push(`Hay ${c.ambiguas.length} tanques listos con «${d.granel}» (${c.ambiguas.map((t) => t.codigo).join(', ')}); elegí cuál.`)
      } else {
        campos.fabricacion_id = c.item.fabricacion_id
        if (!c.exacta) avisos.push(`«${d.granel}» se asoció al tanque ${c.item.codigo} (${c.item.producto}). Revisalo.`)
      }
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
