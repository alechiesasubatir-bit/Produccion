import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { expect, test } from 'vitest'

// Ningún color hex fuera de tokens.css: los colores se nombran una sola vez y se usan por token.
const SRC = resolve(__dirname, '..')
const TOKENS = resolve(__dirname, 'tokens.css')

function cssDe(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? cssDe(p) : p.endsWith('.css') ? [p] : []
  })
}

function hexSueltos(archivos: string[]): string[] {
  return archivos.flatMap((p) =>
    readFileSync(p, 'utf8')
      .split('\n')
      .flatMap((linea, i) => (linea.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => `${relative(SRC, p)}:${i + 1} ${h}`)),
  )
}

test('ningún CSS fuera de tokens.css usa colores hex', () => {
  expect(hexSueltos(cssDe(SRC).filter((p) => resolve(p) !== TOKENS))).toEqual([])
})

test('la guardia detecta un hex (tokens.css sí los tiene)', () => {
  expect(hexSueltos([TOKENS]).length).toBeGreaterThan(0)
})
