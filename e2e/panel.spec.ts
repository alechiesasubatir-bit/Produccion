import { expect, test } from '@playwright/test'
import { simularSupabase } from './mocks'

test.use({ viewport: { width: 1440, height: 900 } })

test('encargada: nueva orden → flujo → tanque con QR → configuración', async ({ page }) => {
  await simularSupabase(page, 'panel')
  await page.goto('panel')

  const columnas = page.getByRole('heading', { level: 2 })
  await expect(columnas).toHaveCount(6)

  await page.getByRole('button', { name: '+ Nueva orden' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Nueva orden' })
  await dialogo.getByLabel('Tanque').selectOption('t1')
  await dialogo.getByLabel('Producto').selectOption('p1')
  await dialogo.getByLabel('Litros').fill('1200')
  await dialogo.getByLabel('Lote').fill('L-77')
  await dialogo.getByRole('button', { name: 'Crear orden' }).click()

  const cola = page.getByRole('region', { name: 'Cola' })
  await expect(cola.getByRole('article', { name: 'Lavandina · 1200 L' })).toBeVisible()
  // el contador de KPIs se anima hasta el valor nuevo
  await expect(page.locator('.kpi', { hasText: 'en cola' }).locator('.kpi-valor')).toHaveText('1')
  await page.screenshot({ path: 'test-results/panel-1440.png', fullPage: true })

  await page.getByRole('link', { name: 'Tanques' }).click()
  await page.getByRole('button', { name: 'Tanque T-01' }).click()
  const detalle = page.getByRole('complementary', { name: 'Tanque T-01' })
  await expect(detalle.locator('.qr svg')).toBeVisible()
  await expect(detalle.getByText(/planta\?tanque=T-01$/)).toBeVisible()
  await page.screenshot({ path: 'test-results/panel-tanques-1440.png', fullPage: true })

  await page.getByRole('link', { name: 'Configuración' }).click()
  await expect(page.getByRole('row', { name: /Lavandina/ })).toBeVisible()
})
