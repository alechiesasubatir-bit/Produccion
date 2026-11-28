import { test, type Page } from '@playwright/test'

// Capturas de la demo para comparar el antes y el después de un cambio visual.
// Solo corre con CAPTURAS=<carpeta>: `CAPTURAS=antes npx playwright test capturas`.
// Las PNG quedan en capturas/<carpeta>/ (fuera del repo).
const carpeta = process.env.CAPTURAS

const VISTAS: { nombre: string; ruta: string; ancho?: number; alto?: number; abrir?: (p: Page) => Promise<void> }[] = [
  { nombre: 'flujo', ruta: 'demo' },
  { nombre: 'tanques', ruta: 'demo/tanques' },
  { nombre: 'kpis', ruta: 'demo/kpis' },
  { nombre: 'monitor', ruta: 'demo/monitor' },
  { nombre: 'tablet', ruta: 'demo/tablet' },
  { nombre: 'tablet-vertical', ruta: 'demo/tablet', ancho: 820, alto: 1180 },
  {
    nombre: 'detalle-orden',
    ruta: 'demo',
    abrir: (p) => p.getByRole('region', { name: 'Fabricando' }).getByRole('button', { name: /^Ver detalle de / }).first().click(),
  },
  {
    nombre: 'kpis-productividad',
    ruta: 'demo/kpis',
    abrir: async (p) => {
      await p.getByRole('button', { name: 'Mes anterior' }).click()
      await p.getByRole('button', { name: 'Productividad' }).click()
    },
  },
  { nombre: 'nueva-orden', ruta: 'demo', abrir: (p) => p.getByRole('button', { name: /Nueva orden/ }).click() },
  {
    nombre: 'detalle-tanque',
    ruta: 'demo/tanques',
    abrir: (p) => p.getByRole('button', { name: /^Tanque T-/ }).first().click(),
  },
]

for (const v of VISTAS) {
  test(`captura ${v.nombre}`, async ({ page }) => {
    test.skip(!carpeta, 'solo con CAPTURAS=<carpeta>')
    await page.setViewportSize({ width: v.ancho ?? 1440, height: v.alto ?? 900 })
    await page.goto(v.ruta)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    if (v.abrir) {
      await v.abrir(page)
      await page.waitForTimeout(600)
    }
    await page.screenshot({ path: `capturas/${carpeta}/${v.nombre}.png`, fullPage: !v.abrir, animations: 'disabled' })
  })
}
