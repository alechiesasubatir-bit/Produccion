import { expect, test } from '@playwright/test'
import { MP_BACTIPRO, simularSupabase } from './mocks'

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

test('fabricación con fórmula: Finalizar bloqueado hasta completar lote y pesado de las 4 MP', async ({ page }) => {
  await simularSupabase(page, 'planta', { mp: MP_BACTIPRO })
  await page.goto('planta?tanque=T-01')
  await page.getByRole('button', { name: /Laura Paz/ }).click()
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: 'Tomar' }).click()
  await expect(page.getByText('Listo: empezaste Lavandina · 1200 L')).toBeVisible()

  const mias = page.getByRole('region', { name: 'Mis tareas' })
  const finalizar = mias.getByRole('button', { name: 'Finalizar' })
  await expect(mias.getByText('0 de 4 MP')).toBeVisible()
  await expect(finalizar).toBeDisabled()
  await expect(mias.getByText('Faltan 4 MP por completar.')).toBeVisible()
  await page.screenshot({ path: 'test-results/planta-mp-1180.png', fullPage: true })

  for (const [i, mp] of MP_BACTIPRO.entries()) {
    await mias.getByLabel(`Lote de ${mp.codigo}`).fill(`L${i + 1}-2026`)
    await mias.getByLabel(`Pesado ${mp.codigo}`).check()
    await expect(mias.getByText(`${i + 1} de 4 MP`)).toBeVisible()
  }
  await expect(mias.getByText(/Faltan \d+ MP/)).toHaveCount(0)
  await expect(finalizar).toBeEnabled()
  await page.screenshot({ path: 'test-results/planta-mp-completa-1180.png', fullPage: true })

  await finalizar.click()
  await expect(page.getByText('Listo: finalizaste Lavandina · 1200 L')).toBeVisible()
  await expect(page.getByText('No tenés tareas en curso.')).toBeVisible()
})
