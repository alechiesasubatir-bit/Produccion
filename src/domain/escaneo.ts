// Normalización de nombres y números de Macrosoft y búsqueda en catálogos.

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
