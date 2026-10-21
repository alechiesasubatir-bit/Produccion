import { expect, test } from '@playwright/test'

// La DEMO no usa mocks: el simulador vive en la página. Se verifica que nada salga a la red.
test.use({ viewport: { width: 1440, height: 900 } })

test('demo pública: sin usuario, en vivo, se puede tocar y no sale a la red', async ({ page }) => {
  const externas: string[] = []
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname
    if (!['localhost', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(host)) externas.push(r.url())
  })

  await page.goto('demo')
  await expect(page.getByText('DEMO · datos de prueba')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(6)
  expect(await page.getByRole('article').count()).toBeGreaterThan(8)

  // el tiempo simulado corre
  const hora = page.getByRole('timer', { name: 'Hora simulada' })
  const antes = await hora.textContent()
  await page.getByRole('button', { name: '300×' }).click()
  await expect(hora).not.toHaveText(antes ?? '', { timeout: 5000 })
  await page.screenshot({ path: 'test-results/demo-flujo-1440.png' })

  // en pausa, iniciar una orden de la cola la pasa a Fabricando
  await page.getByRole('button', { name: 'Pausa', exact: true }).click()
  const cola = page.getByRole('region', { name: 'Cola' })
  const tarjeta = cola.getByRole('article').first()
  const nombre = (await tarjeta.getAttribute('aria-label'))!
  await tarjeta.getByRole('button', { name: 'Iniciar' }).click()
  await expect(page.getByRole('region', { name: 'Fabricando' }).getByRole('article', { name: nombre })).toBeVisible()

  await page.getByRole('link', { name: 'Tanques' }).click()
  await expect(page.getByRole('button', { name: 'Tanque T-16' })).toBeVisible()

  await page.getByRole('link', { name: 'Monitor' }).click()
  await expect(page.getByRole('list', { name: 'Tanques' }).getByRole('listitem')).toHaveCount(16)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/demo-monitor-1920.png' })
  await page.getByRole('link', { name: 'Salir del monitor' }).click()
  await expect(page).toHaveURL(/\/demo$/)

  expect(externas).toEqual([])
})
