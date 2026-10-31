import { expect, type Page, test } from '@playwright/test'

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

test('the canvas renders the example item', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
  expect(errors).toEqual([])
})

test('frame.html renders one item alone', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/frame.html?item=example')
  await expect(page.locator('.canvas-frame-root')).toContainText('Canvas is ready')
  expect(errors).toEqual([])
})
