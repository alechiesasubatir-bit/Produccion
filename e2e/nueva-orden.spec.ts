import { expect, test } from '@playwright/test'
import { MP_BACTIPRO, simularSupabase } from './mocks'

// Laptop con escala de Windows al 125 % y barras del navegador: ~600 px de alto útil.
test.use({ viewport: { width: 1229, height: 600 } })

test('en una pantalla baja, los botones de Nueva orden se ven enteros sin deslizar', async ({ page }) => {
  await simularSupabase(page, 'panel')
  await page.goto('panel')
  await page.getByRole('button', { name: '+ Nueva orden' }).click()
  const d = page.getByRole('dialog', { name: 'Nueva orden' })
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

// La encargada sube el PDF «Movimientos de Produccion» real: lo lee pdf.js en el navegador.
test('Fabricación desde el PDF de la fórmula: lee el lote y las MP y crea la orden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { formulasCreadas } = await simularSupabase(page, 'panel')
  await page.goto('panel')
  await page.getByRole('button', { name: '+ Nueva orden' }).click()
  const d = page.getByRole('dialog', { name: 'Nueva orden' })
  await d.getByRole('button', { name: 'Fabricación', exact: true }).click()
  await d.getByRole('button', { name: 'Subir PDF de fórmula' }).click()
  await d.getByLabel('PDF de la fórmula').setInputFiles('e2e/fixtures/BACTIPRO.pdf')

  const tarjeta = d.getByRole('region', { name: /Lote 17702/ })
  await expect(tarjeta.getByRole('heading')).toHaveText('Lote 17702 · Bactipro · 1000 L')
  await expect(tarjeta.getByRole('row')).toHaveCount(5) // cabecera + 4 MP
  await expect(tarjeta.getByLabel('Producto')).toHaveValue('p2') // encontrado por nombre
  await tarjeta.getByLabel('Tanque').selectOption('t1')
  await tarjeta.getByLabel('Vencimiento').fill('2028-10-21')
  await page.screenshot({ path: 'test-results/formula-pdf-1440.png', fullPage: true })

  await tarjeta.getByRole('button', { name: 'Crear', exact: true }).click()
  // Única fórmula del PDF: queda «Creada», se cierra la ventana y aparece en el flujo.
  await expect(d).toBeHidden()
  await expect(page.getByText('Bactipro').first()).toBeVisible()
  expect(formulasCreadas).toHaveLength(1)
  expect(formulasCreadas[0].p_fab).toMatchObject({
    tanque_id: 't1', producto_id: 'p2', litros: 1000, lote: '17702', vencimiento: '2028-10-21',
    fecha_formula: '2026-10-21', codigo_producto: 'F8',
  })
  expect(formulasCreadas[0].p_mp.map((m) => [m.codigo, m.cantidad])).toEqual(MP_BACTIPRO.map((m) => [m.codigo, m.cantidad]))
})
