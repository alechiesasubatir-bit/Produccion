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

test('demo: la pestaña Tablet muestra la app de planta y una acción se ve en el flujo', async ({ page }) => {
  await page.goto('demo')
  await page.getByRole('button', { name: 'Pausa', exact: true }).click()
  await page.getByRole('link', { name: 'Tablet' }).click()
  const tablet = page.getByRole('region', { name: 'Vista de la tablet' })
  await expect(tablet.getByText('Control de Producción')).toBeVisible()
  await page.screenshot({ path: 'test-results/demo-tablet-1440.png' })
  // elegir una operaria: entra directo, sin PIN
  await tablet.getByRole('button').first().click()
  await expect(tablet.getByRole('button', { name: 'No soy yo' })).toBeVisible()
  await page.screenshot({ path: 'test-results/demo-tablet-tareas-1440.png' })

  // tomar una fabricación en cola y verla en Fabricando (mismo simulador que el panel)
  const tarea = tablet.getByRole('region', { name: 'Disponibles para tomar' }).getByRole('article').filter({ hasText: 'En cola' }).filter({ has: page.getByRole('img') }).first()
  const nombre = (await tarea.getAttribute('aria-label'))!
  await tarea.getByRole('button', { name: 'Tomar' }).click()
  await page.getByRole('link', { name: 'Flujo' }).click()
  await expect(page.getByRole('region', { name: 'Fabricando' }).getByRole('article', { name: nombre })).toBeVisible()
})

test('demo: una operaria se suma a una orden en curso y el flujo muestra a las dos', async ({ page }) => {
  await page.goto('demo')
  await page.getByRole('button', { name: 'Pausa', exact: true }).click()
  await page.getByRole('link', { name: 'Tablet' }).click()
  const tablet = page.getByRole('region', { name: 'Vista de la tablet' })
  await tablet.getByRole('button').first().click()
  const quien = ((await tablet.getByRole('heading', { level: 1 }).textContent()) ?? '').replace('Hola, ', '')

  // sumarse a una fabricación que está en marcha (siempre hay varias en la demo)
  const enCurso = tablet.getByRole('region', { name: 'En curso para sumarme' })
  const orden = enCurso.getByRole('article').filter({ hasText: 'Fabricando' }).first()
  const tanque = (await orden.locator('.tarea-tanque').textContent())!
  const otra = ((await orden.locator('.tarea-con').textContent()) ?? '').replace('Con: ', '')
  await orden.getByRole('button', { name: 'Sumarme' }).click()
  await tablet.getByRole('dialog', { name: 'Confirmar' }).getByRole('button', { name: 'Confirmar' }).click()
  await expect(tablet.getByRole('region', { name: 'Mis tareas' }).getByRole('article').filter({ hasText: tanque })).toBeVisible()

  // en el flujo la tarjeta de esa fabricación lista a las dos operarias
  await page.getByRole('link', { name: 'Flujo' }).click()
  const tarjeta = page.getByRole('region', { name: 'Fabricando' }).getByRole('article').filter({ hasText: tanque })
  const operarias = tarjeta.locator('.tf-operarias')
  await expect(operarias).toContainText(quien)
  await expect(operarias).toContainText(otra.split(' · ')[0])
  await page.screenshot({ path: 'test-results/demo-dos-operarias-1440.png' })
})

test('demo: una fabricación «En control» aparece en el flujo', async ({ page }) => {
  await page.goto('demo')
  await page.getByRole('button', { name: '300×' }).click()
  const enControl = page.getByRole('region', { name: 'Fabricando' }).getByRole('article').filter({ hasText: 'En control' })
  await expect(enControl.first()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: 'test-results/demo-en-control-1440.png' })
})
