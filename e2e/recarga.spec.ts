import { expect, test } from '@playwright/test'
import { simularSupabase } from './mocks'

// Tras un deploy, un index.html viejo en caché pide un bundle que ya no existe: la página quedaba
// en blanco. Ahora detecta el script que no cargó y se recarga una vez salteando la caché.
test('si el código de la app no carga (index viejo en caché), se recarga sola y anda', async ({ page }) => {
  await simularSupabase(page, 'panel')
  let primera = true
  await page.route('**/src/main.tsx*', (r) => {
    if (primera) {
      primera = false
      return r.fulfill({ status: 404, body: '' })
    }
    return r.continue()
  })
  const paginas: string[] = []
  page.on('request', (r) => r.isNavigationRequest() && paginas.push(r.url()))
  await page.goto('panel')
  await expect(page.getByRole('link', { name: 'Monitor' })).toBeVisible()
  expect(paginas.some((u) => /[?&]v=\d+/.test(u))).toBe(true) // se recargó salteando la caché…
  await expect(page).toHaveURL(/\/panel$/) // …y al cargar quitó el ?v=
})
