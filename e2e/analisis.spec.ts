import { expect, test } from '@playwright/test'
import { simularSupabase } from './mocks'

test.use({ viewport: { width: 1440, height: 900 } })

// PNG 1×1 para el input de archivo del escaneo
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('historial, KPIs, alertas y escaneo', async ({ page }) => {
  await simularSupabase(page, 'panel')
  await page.goto('panel/historial')

  await expect(page.getByRole('row')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/historial-1440.png', fullPage: true })
  const descarga = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  expect((await descarga).suggestedFilename()).toMatch(/^prodcontrol-historial-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.csv$/)

  await page.getByRole('link', { name: 'KPIs' }).click()
  await page.getByRole('button', { name: 'Ranking' }).click()
  await expect(page.getByRole('row', { name: /Rosa Díaz/ })).toContainText('🥇')
  await page.screenshot({ path: 'test-results/kpis-1440.png', fullPage: true })

  await expect(page.getByRole('link', { name: /Alertas/ })).toContainText('1')
  await page.getByRole('link', { name: /Alertas/ }).click()
  await page.getByRole('region', { name: 'Activas' }).getByRole('button', { name: 'Posponer 1 hora' }).click()
  await expect(page.getByRole('region', { name: 'Pospuestas y leídas' })).toContainText('más de 9 horas')
  await page.screenshot({ path: 'test-results/alertas-1440.png', fullPage: true })

  await page.getByRole('link', { name: 'Flujo' }).click()
  await page.getByRole('button', { name: '+ Nueva orden' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Nueva orden' })
  await dialogo.getByRole('button', { name: 'Escanear hoja' }).click()
  await dialogo.getByLabel('Foto de la hoja').setInputFiles({ name: 'hoja.png', mimeType: 'image/png', buffer: PNG })
  await dialogo.getByRole('button', { name: 'Analizar' }).click()
  await expect(dialogo.getByLabel('Producto')).toHaveValue('p1')
  await expect(dialogo.getByLabel('Litros')).toHaveValue('1500')
  await expect(dialogo.getByLabel('Lote')).toHaveValue('L-900')
})
