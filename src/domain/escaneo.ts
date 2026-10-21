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
