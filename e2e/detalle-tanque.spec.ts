import { expect, test } from '@playwright/test'
import { simularSupabase } from './mocks'

// El panel de un tanque se ve entero, sin barra de desplazamiento, también en una laptop.
for (const [ancho, alto] of [[1229, 600], [1366, 768]]) {
  test(`el panel del tanque entra entero en ${ancho}×${alto}`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto })
    await simularSupabase(page, 'panel')
    await page.goto('panel/tanques')
    await page.getByRole('button', { name: 'Tanque T-01' }).click()
    const panel = page.getByRole('complementary', { name: 'Tanque T-01' })
    await expect(panel.getByRole('button', { name: 'Nueva orden en este tanque' })).toBeVisible()
    await page.waitForTimeout(600) // animación de entrada
    const medida = await panel.evaluate((e) => ({ contenido: e.scrollHeight, visible: e.clientHeight, abajo: e.getBoundingClientRect().bottom }))
    expect(medida.contenido).toBeLessThanOrEqual(medida.visible)
    expect(medida.abajo).toBeLessThanOrEqual(alto)
    await expect(panel.locator('.qr svg')).toBeVisible()
  })
}

// Un tanque en uso suma acciones y recorrido: también tiene que entrar (datos de la demo).
for (const [ancho, alto] of [[1229, 600], [1366, 768]]) {
  test(`el panel de un tanque envasando entra entero en ${ancho}×${alto}`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto })
    await page.goto('demo/tanques')
    await page.getByRole('button', { name: 'Pausa', exact: true }).click()
    await page.locator('.pared-celda:has(.tanque[data-estado="envasando"]) button').first().click()
    const panel = page.locator('.detalle-tanque')
    await expect(panel.getByText('Recorrido')).toBeVisible()
    await page.waitForTimeout(600)
    const medida = await panel.evaluate((e) => ({ contenido: e.scrollHeight, visible: e.clientHeight, abajo: e.getBoundingClientRect().bottom }))
    expect(medida.contenido).toBeLessThanOrEqual(medida.visible)
    expect(medida.abajo).toBeLessThanOrEqual(alto)
  })
}
