import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Las animaciones viven en movimiento.css y todas se quedan quietas con «movimiento reducido».
const ruta = resolve(__dirname, 'movimiento.css')

function bloqueReducido(css: string): string {
  const i = css.indexOf('@media (prefers-reduced-motion: reduce)')
  if (i < 0) return ''
  let nivel = 0
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') nivel++
    if (css[j] === '}' && --nivel === 0) return css.slice(i, j)
  }
  return css.slice(i)
}

describe('movimiento.css', () => {
  it('existe', () => {
    expect(existsSync(ruta)).toBe(true)
  })

  it.each(['avanza', 'onda', 'salto', 'barrido', 'respirar', 'ola', 'burbuja'])('define @keyframes %s', (k) => {
    expect(readFileSync(ruta, 'utf8')).toMatch(new RegExp(`@keyframes ${k}\\b`))
  })

  it.each(['.etapas', '.pulso-vivo', '.salto', '.levanta'])('%s queda quieto con movimiento reducido', (sel) => {
    expect(bloqueReducido(readFileSync(ruta, 'utf8'))).toContain(sel)
  })
})

// app.css carga después de movimiento.css: la transición de .pared-celda que gana es la de app.css,
// así que ahí tiene que estar el transform (si no, el levantarse al pasar el mouse salta de golpe).
it('la ficha de la pared de tanques se levanta con transición', () => {
  const app = readFileSync(resolve(__dirname, 'app.css'), 'utf8')
  const bloques = [...app.matchAll(/(?:^|\n)\.pared-celda\s*\{([^}]*)\}/g)].map((m) => m[1])
  const transicion = bloques.flatMap((b) => b.match(/transition:[^;]*/g) ?? []).pop() ?? ''
  expect(transicion).toContain('transform')
})
