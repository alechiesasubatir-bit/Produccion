import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Contraste AA (≥ 4,5:1) de los pares de tokens que llevan texto. Lee tokens.css, resuelve var(--x) hasta un hex.
const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')))
const tokens = new Map<string, string>()
for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim())

function hex(nombre: string, profundidad = 0): string {
  const v = tokens.get(nombre)
  if (v === undefined) throw new Error(`falta el token ${nombre}`)
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  if (ref && profundidad < 10) return hex(ref[1], profundidad + 1)
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v
  throw new Error(`${nombre} no termina en un hex: ${v}`)
}

function luminancia(h: string): number {
  const s = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(s.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(hex(a)), luminancia(hex(b))].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const ETAPAS = ['cola', 'fabricando', 'control', 'envasando', 'fraccionado', 'pausado', 'terminada']

describe('contraste AA de los tokens', () => {
  it.each(ETAPAS)('chip %s: tinta sobre fondo', (e) => {
    expect(contraste(`--etapa-${e}-tinta`, `--etapa-${e}-fondo`)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['--apagado', '--papel'],
    ['--apagado', '--tarjeta'],
    ['--boton-tinta', '--boton-fondo'],
    ['--barra-tinta-2', '--barra'],
  ])('%s sobre %s', (texto, fondo) => {
    expect(contraste(texto, fondo)).toBeGreaterThanOrEqual(4.5)
  })
})
