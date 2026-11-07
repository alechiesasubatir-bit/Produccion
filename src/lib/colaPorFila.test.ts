import { describe, expect, it } from 'vitest'
import { crearColaPorFila } from './colaPorFila'

const diferido = () => {
  let resolver!: (v: string) => void
  let rechazar!: (e: unknown) => void
  const promesa = new Promise<string>((res, rej) => {
    resolver = res
    rechazar = rej
  })
  return { promesa, resolver, rechazar }
}
const tic = () => new Promise((r) => setTimeout(r, 0))

describe('crearColaPorFila', () => {
  it('una tarea de la misma fila no arranca hasta que termina la anterior', async () => {
    const encolar = crearColaPorFila()
    const a = diferido()
    const orden: string[] = []
    const p1 = encolar('mp1', () => (orden.push('a'), a.promesa))
    const p2 = encolar('mp1', async () => (orden.push('b'), 'b'))
    await tic()
    expect(orden).toEqual(['a'])
    a.resolver('a')
    expect(await p1).toBe('a')
    expect(await p2).toBe('b')
    expect(orden).toEqual(['a', 'b'])
  })

  it('filas distintas no se esperan entre sí', async () => {
    const encolar = crearColaPorFila()
    const orden: string[] = []
    void encolar('mp1', () => (orden.push('a'), new Promise(() => {})))
    void encolar('mp2', async () => orden.push('b'))
    await tic()
    expect(orden).toEqual(['a', 'b'])
  })

  it('si la anterior falla, la siguiente igual corre', async () => {
    const encolar = crearColaPorFila()
    const a = diferido()
    const p1 = encolar('mp1', () => a.promesa)
    const p2 = encolar('mp1', async () => 'b')
    a.rechazar(new Error('red'))
    await expect(p1).rejects.toThrow('red')
    expect(await p2).toBe('b')
  })
})
