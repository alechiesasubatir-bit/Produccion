import { expect, test } from '@playwright/test'
import { MP_BACTIPRO, simularSupabase } from './mocks'

test('operaria (sin PIN) → tomar → finalizar', async ({ page }) => {
  await simularSupabase(page)
  await page.goto('planta?tanque=T-01')

  await expect(page.getByRole('heading', { name: '¿Quién trabaja?' })).toBeVisible()
  await page.getByRole('button', { name: /Laura Paz/ }).click()

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

test('equipo: sumarme a un envasado en curso y salir declarando cuánto envasé', async ({ page }) => {
  const { llamadas } = await simularSupabase(page, 'planta', { equipo: true })
  await page.goto('planta?tanque=T-01')
  await page.getByRole('button', { name: /Laura Paz/ }).click()

  const enCurso = page.getByRole('region', { name: 'En curso para sumarme' })
  await expect(enCurso.getByText('Con: Rosa Díaz')).toBeVisible()
  await enCurso.getByRole('button', { name: 'Sumarme' }).click()
  await page.getByRole('dialog', { name: 'Confirmar' }).getByRole('button', { name: 'Confirmar' }).click()

  const mias = page.getByRole('region', { name: 'Mis tareas' })
  const tarjeta = mias.getByRole('article', { name: /Lavandina · 20 × 5L/ })
  await expect(tarjeta.getByText('Con: Rosa Díaz')).toBeVisible()
  expect(llamadas.at(-1)).toMatchObject({ p_id: 'V1', p_accion: 'sumarse', p_empleado_id: 'E1' })

  // salir pide cuánto envasó: sin número no se puede confirmar
  await tarjeta.getByRole('button', { name: 'Salir de la orden' }).click()
  const d = page.getByRole('dialog', { name: '¿Cuánto envasaste?' })
  await expect(d.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  await page.screenshot({ path: 'test-results/planta-salir-1180.png', fullPage: true })
  await d.getByLabel('Laura Paz').fill('30')
  await d.getByRole('button', { name: 'Confirmar' }).click()

  await expect(mias.getByText('No tenés tareas en curso.')).toBeVisible()
  expect(llamadas.at(-1)).toMatchObject({
    p_id: 'V1',
    p_accion: 'salir',
    p_cantidades: [{ empleado_id: 'E1', cantidad: 30, unidad: 'L' }],
  })
  // sigue en curso para sumarse (Rosa continúa)
  await expect(enCurso.getByText('Con: Rosa Díaz')).toBeVisible()
})

test('control para liberación: Controlar → ¿Quién controla? → pH/densidad/OK → Aprobar → confirmar', async ({ page }) => {
  const { controlesRegistrados } = await simularSupabase(page, 'planta', { enControl: true })
  await page.goto('planta?tanque=T-01')
  await page.getByRole('button', { name: /Laura Paz/ }).click()

  const grupo = page.getByRole('region', { name: 'En control' })
  await expect(grupo.getByText('Intento 1')).toBeVisible()
  await grupo.getByRole('button', { name: 'Controlar' }).click()

  await expect(page.getByRole('heading', { name: '¿Quién controla?' })).toBeVisible()
  await page.getByRole('button', { name: 'Marta Gil' }).click()

  await expect(page.getByText(/Control — Intento 1/)).toBeVisible()
  await page.getByLabel('pH').fill('7,5')
  await page.getByLabel('Densidad').fill('1,02')
  await page.getByRole('group', { name: 'Perfume' }).getByRole('button', { name: 'OK', exact: true }).click()
  await page.getByRole('group', { name: 'Visual' }).getByRole('button', { name: 'OK', exact: true }).click()
  await page.screenshot({ path: 'test-results/planta-control-1180.png', fullPage: true })
  await page.getByRole('button', { name: 'Aprobar' }).click()
  await page.getByRole('button', { name: 'Sí, aprobar' }).click()

  await expect(page.getByText(/Control — Intento/)).toHaveCount(0)
  expect(controlesRegistrados).toHaveLength(1)
  expect(controlesRegistrados[0]).toMatchObject({
    p_fab_id: 'F1',
    p_ph: 7.5,
    p_densidad: 1.02,
    p_perfume_ok: true,
    p_visual_ok: true,
    p_resultado: 'aprobado',
    p_firmante: 'L1',
  })
})
