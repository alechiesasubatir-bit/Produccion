import { expect, test } from '@playwright/test'
import { simularSupabase } from './mocks'

test('operaria → PIN → tomar → finalizar', async ({ page }) => {
  await simularSupabase(page)
  await page.goto('planta?tanque=T-01')

  await expect(page.getByRole('heading', { name: '¿Quién trabaja?' })).toBeVisible()
  await page.getByRole('button', { name: /Laura Paz/ }).click()
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Hola, Laura Paz' })).toBeVisible()
  await page.screenshot({ path: 'test-results/planta-1180.png', fullPage: true })

  await page.getByRole('button', { name: 'Tomar' }).click()
  await expect(page.getByText('Listo: empezaste Lavandina · 1200 L')).toBeVisible()

  const finalizar = page.getByRole('region', { name: 'Mis tareas' }).getByRole('button', { name: 'Finalizar' })
  await expect(finalizar).toBeVisible()
  const alto = (await finalizar.boundingBox())?.height ?? 0
  expect(alto).toBeGreaterThanOrEqual(64)

  await finalizar.click()
  await expect(page.getByText('Listo: finalizaste Lavandina · 1200 L')).toBeVisible()
  await expect(page.getByText('No tenés tareas en curso.')).toBeVisible()
})
