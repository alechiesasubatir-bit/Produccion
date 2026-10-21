import { expect, test } from '@playwright/test'
import { simularSupabase } from './mocks'

// Laptop con escala de Windows al 125 % y barras del navegador: ~600 px de alto útil.
test.use({ viewport: { width: 1229, height: 600 } })

test('en una pantalla baja, los botones de Nueva orden se ven enteros sin deslizar', async ({ page }) => {
  await simularSupabase(page, 'panel')
  await page.goto('panel')
  await page.getByRole('button', { name: '+ Nueva orden' }).click()
  const d = page.getByRole('dialog', { name: 'Nueva orden' })
  await d.getByRole('button', { name: 'Escanear hoja' }).click() // lo más alto que se pone
  for (const nombre of ['Cancelar', 'Crear orden']) {
    const boton = d.getByRole('button', { name: nombre, exact: true }).last()
    const caja = (await boton.boundingBox())!
    const modal = (await page.locator('.modal').boundingBox())!
    expect(caja.y + caja.height, nombre).toBeLessThanOrEqual(modal.y + modal.height - 8)
    expect(caja.y + caja.height, nombre).toBeLessThanOrEqual(600)
  }
})

// Con datos reales los nombres son largos ("T-02 · Alcohol Rectificado 70% … · quedan 700 L sin asignar"):
// la ventana no se ensancha ni pide barras, en ningún tipo. Datos de la demo (sin mocks).
test('Nueva orden se ve entera, sin barras, con nombres largos en cualquier tipo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 657 })
  await page.goto('demo')
  await page.getByRole('button', { name: 'Pausa', exact: true }).click()
  await page.getByRole('button', { name: '+ Nueva orden' }).click()
  const d = page.getByRole('dialog', { name: 'Nueva orden' })
  for (const tipo of ['Fabricación', 'Envasado', 'Fraccionado']) {
    await d.getByRole('button', { name: tipo, exact: true }).click()
    const listas = d.locator('select')
    for (let i = 0; i < (await listas.count()); i++) {
      if ((await listas.nth(i).locator('option').count()) > 1) await listas.nth(i).selectOption({ index: 1 })
    }
    const m = await page.locator('.modal').evaluate((e) => ({ ancho: e.clientWidth, anchoTodo: e.scrollWidth, alto: e.clientHeight, altoTodo: e.scrollHeight }))
    expect(m.anchoTodo, `${tipo}: ancho`).toBeLessThanOrEqual(m.ancho)
    expect(m.altoTodo, `${tipo}: alto`).toBeLessThanOrEqual(m.alto)
  }
})
