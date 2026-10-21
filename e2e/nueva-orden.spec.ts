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
