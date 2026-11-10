import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, type Page, test } from '@playwright/test'

const LISTEN = fileURLToPath(new URL('../../skills/design-canvas/scripts/listen.sh', import.meta.url))
const SHARE = fileURLToPath(new URL('../../skills/design-canvas/scripts/share.sh', import.meta.url))

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

const REGISTRY = 'design-canvas/smoke/registry.tsx'

// The dev server writes moves and new notes into registry.tsx. Tests about the
// agent path need the write refused, which is what makes a change fall back to
// the agent; refusing it also leaves the registry as installed for the tests after.
// Puts the registry back as installed and waits for the page to take that update, so
// it cannot land during the next test.
async function restoreRegistry(page: Page, original: string) {
  if (readFileSync(REGISTRY, 'utf8') === original) return
  const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
  writeFileSync(REGISTRY, original)
  await updated
}

async function refuseSaves(page: Page) {
  await page.route('**/__design-canvas/edit', (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { edits?: { id: string }[]; adds?: unknown[] }
    return route.fulfill({
      json: { applied: [], missing: (body.edits ?? []).map((e) => e.id), rejected: (body.adds ?? []).map((_, i) => i) },
    })
  })
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

test('an item moves to the trash and is put back', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  const item = page.locator('.canvas-item[data-canvas-item="example"]')
  await expect(item).toContainText('Canvas is ready')
  await page.getByRole('button', { name: 'Move Example · replace me to the trash' }).click()
  await expect(item).toHaveCount(0)
  // The trash is saved with the layout.
  await page.reload()
  await expect(item).toHaveCount(0)
  await page.getByRole('button', { name: 'Trash, 1 item' }).click()
  const trash = page.getByRole('dialog', { name: 'Trash' })
  await expect(trash.locator('.canvas-trash-thumb')).toContainText('Canvas is ready')
  await trash.getByRole('button', { name: 'Put back Example · replace me' }).click()
  await expect(item).toContainText('Canvas is ready')
  await expect(page.getByRole('button', { name: /^Trash/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('copied annotations ask for a new version by default', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Annotate', exact: true }).click()
  await page.locator('.canvas-preview h2').click()
  const note = page.getByRole('dialog', { name: /^Annotation on/ })
  await expect(note.getByRole('checkbox', { name: 'Apply to a new version' })).toBeChecked()
  await note.getByRole('textbox').fill('Shorter title')
  await note.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Copy 1 change' }).click()
  await expect(page.locator('.canvas-toast')).toContainText('Copied 1 change')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Keep the original and add a new version: Example · replace me (1)')
  expect(errors).toEqual([])
})

test('a note added in annotate mode waits as a ghost and travels with the changes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await refuseSaves(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.mouse.click(700, 500)
  await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
  await page.keyboard.type('Why this version')
  await page.keyboard.press('Escape')
  const ghost = page.locator('[data-board-ghost]')
  await expect(ghost).toContainText('Why this version')
  await expect(ghost).toContainText('Not applied yet')
  // Leaving annotate mode with a change waiting says so, so it is not forgotten.
  await page.getByRole('button', { name: 'Annotate', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.canvas-toast')).toContainText("1 change isn't applied yet")
  await page.getByRole('button', { name: 'Copy 1 change' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Add a note at')
  expect(text).toContain('Why this version')
  await expect(ghost).toContainText('Sent')
  expect(errors).toEqual([])
})

test('a section drawn on empty canvas lists the items inside it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await refuseSaves(page)
  await page.goto('/')
  const item = page.locator('.canvas-item[data-canvas-item="example"]')
  await expect(item).toBeVisible()
  // The first paint fits the canvas to the window once fonts load; measure after that moved the camera.
  await page.waitForTimeout(600)
  const box = (await item.boundingBox())!
  await page.getByRole('button', { name: 'Section', exact: true }).click()
  await page.mouse.move(box.x - 40, box.y - 40)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
  await page.keyboard.type('Set aside')
  await page.keyboard.press('Enter')
  // The tab shows the grip an item's name has, so it reads as something to pull.
  await expect(page.locator('[data-board-ghost] .canvas-section-grip')).toBeVisible()
  await page.getByRole('button', { name: 'Copy 1 change' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Add a section “Set aside”')
  expect(text).toContain('Example · replace me (0,0)')
  expect(errors).toEqual([])
})

test('a placed note moves and resizes, and the change waits for the agent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await refuseSaves(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  // The first paint fits the canvas to the window once fonts load; draw after that moved the camera.
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.mouse.click(700, 400)
  await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
  await page.keyboard.type('Move me')
  await page.keyboard.press('Escape')
  const ghost = page.locator('[data-board-ghost]')
  const before = (await ghost.boundingBox())!
  await page.mouse.move(before.x + 40, before.y + 20)
  await page.mouse.down()
  await page.mouse.move(before.x + 140, before.y + 120, { steps: 6 })
  await page.mouse.up()
  const moved = (await ghost.boundingBox())!
  expect(Math.abs(moved.x - before.x - 100)).toBeLessThan(3)
  expect(Math.abs(moved.y - before.y - 100)).toBeLessThan(3)
  // The press selected it, so its corner grips are there.
  const grip = ghost.locator('.canvas-resize[data-corner="se"]')
  await expect(grip).toBeVisible()
  const g = (await grip.boundingBox())!
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x + g.width / 2 + 80, g.y + g.height / 2 + 60, { steps: 6 })
  await page.mouse.up()
  const resized = (await ghost.boundingBox())!
  expect(resized.width).toBeGreaterThan(moved.width + 60)
  await page.getByRole('button', { name: 'Copy 1 change' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/Add a note at \d+,\d+, \d+×\d+: “Move me”/)
  expect(errors).toEqual([])
})

test('an item moved on the canvas is a change to apply', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await refuseSaves(page)
  await page.goto('/')
  const name = page.locator('.canvas-item[data-canvas-item="example"] .canvas-name')
  await expect(name).toBeVisible()
  // The first paint fits the canvas to the window once fonts load; measure after that moved the camera.
  await page.waitForTimeout(600)
  const box = (await name.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 6 })
  await page.mouse.up()
  // The shared file uses the registry's positions, so a moved item waits for the agent like a note.
  const tag = page.locator('.canvas-item-tag')
  await expect(tag).toContainText('Not applied yet')
  await page.getByRole('button', { name: 'Copy 1 change' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/Move “Example · replace me” \(id example\) to -?\d+,-?\d+/)
  await expect(tag).toContainText('Sent')
  // Putting it back where the registry has it ends the change.
  await tag.getByRole('button', { name: 'Discard this change' }).click()
  await expect(tag).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Copy|Apply) \d+ change/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Discard changes drops every change not applied yet, and Undo brings them back', async ({ page }) => {
  const errors = collectErrors(page)
  await refuseSaves(page)
  await page.goto('/')
  const name = page.locator('.canvas-item[data-canvas-item="example"] .canvas-name')
  await expect(name).toBeVisible()
  await page.waitForTimeout(600)
  // A note waiting for the agent, and an item moved off the registry's position.
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.mouse.click(900, 500)
  await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
  await page.keyboard.type('Gone soon')
  await page.keyboard.press('Escape')
  const box = (await name.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 60, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Copy 2 changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  // The toolbar shrinks when the button goes; keep the pointer off whatever slides under it.
  await page.mouse.move(640, 300)
  await expect(page.locator('.canvas-toast')).toContainText('Discarded 2 changes')
  await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
  await expect(page.locator('.canvas-item-tag')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Copy \d+ change/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('[data-board-ghost]')).toContainText('Gone soon')
  await expect(page.locator('.canvas-item-tag')).toContainText('Not applied yet')
  await expect(page.getByRole('button', { name: 'Copy 2 changes' })).toBeVisible()
  expect(errors).toEqual([])
})

test('a moved item is saved to the registry, with no change waiting for the agent', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    const name = page.locator('.canvas-item[data-canvas-item="example"] .canvas-name')
    await expect(name).toBeVisible()
    await page.waitForTimeout(600)
    // A save re-renders in place: a reload would cut off the next drag and flicker.
    await page.evaluate(() => ((window as unknown as { __samePage: boolean }).__samePage = true))
    const box = (await name.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 6 })
    await page.mouse.up()
    // Written once the pointer pauses; the tag goes when the registry has the position.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toBe(original)
    expect(readFileSync(REGISTRY, 'utf8')).toMatch(/id: "example"[\s\S]*?x: [1-9]\d*/)
    await expect(page.locator('.canvas-item-tag')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Copy|Apply) \d+ change/ })).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __samePage?: boolean }).__samePage)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a new note is saved to the registry once it has text', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Note', exact: true }).click()
    await page.mouse.click(700, 400)
    await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
    await page.keyboard.type('Saved on its own')
    await page.keyboard.press('Escape')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('text: "Saved on its own"')
    // The ghost leaves once the registry has the note, and nothing waits for the agent.
    await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Copy|Apply) \d+ change/ })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('an empty note stays as a draft and is never saved', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Note', exact: true }).click()
    await page.mouse.click(700, 400)
    await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
    await page.keyboard.press('Escape')
    const draft = page.locator('[data-board-ghost]')
    await expect(draft).toContainText('Write a note')
    // Longer than the pause before a save.
    await page.waitForTimeout(900)
    await expect(draft).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^(Copy|Apply) \d+ change/ })).toHaveCount(0)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(original)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a registry update in the middle of a drag does not cancel it', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Annotate', exact: true }).click()
    const box = (await page.locator('.canvas-preview[data-canvas-preview="example"]').boundingBox())!
    const scale = box.width / 360
    await page.mouse.move(box.x + 4 * scale, box.y + 4 * scale)
    await page.mouse.down()
    await page.mouse.move(box.x + 180 * scale, box.y + 30 * scale, { steps: 4 })
    // A save from another tab, or from the agent, rewrites the registry now.
    const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated') })
    appendFileSync(REGISTRY, '\n// touched\n')
    await updated
    await page.mouse.move(box.x + 356 * scale, box.y + 50 * scale, { steps: 4 })
    await page.mouse.up()
    await expect(page.getByRole('dialog', { name: /^Annotation on Example · replace me › area / })).toContainText('heading “Canvas is ready”')
  } finally {
    await restoreRegistry(page, original)
  }
})

test('Delete removes a selected note from the registry, and Undo puts it back', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Note', exact: true }).click()
    await page.mouse.click(700, 400)
    await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
    await page.keyboard.type('Delete me')
    await page.keyboard.press('Escape')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('text: "Delete me"')
    // The saved note replaces its ghost once the registry has it.
    await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
    const note = page.locator('.canvas-note-card', { hasText: 'Delete me' })
    await note.click()
    await page.keyboard.press('Delete')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toContain('Delete me')
    await expect(note).toHaveCount(0)
    await expect(page.locator('.canvas-toast')).toContainText('Note deleted')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('text: "Delete me"')
    await expect(note).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('Backspace in a note being edited edits it, and does not delete the note', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Note', exact: true }).click()
    await page.mouse.click(700, 400)
    await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
    await page.keyboard.type('Keep me!')
    await page.keyboard.press('Escape')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('text: "Keep me!"')
    await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
    const note = page.locator('.canvas-note-card', { hasText: 'Keep me!' })
    await note.dblclick()
    await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Escape')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('text: "Keep me"')
    await expect(page.locator('.canvas-note-card', { hasText: 'Keep me' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a caption is edited in place and saved to the registry', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    const caption = page.locator('.canvas-item[data-canvas-item="example"] .canvas-note')
    await expect(caption).toBeVisible()
    await page.waitForTimeout(600)
    await caption.dblclick()
    const field = page.locator('.canvas-caption-field')
    await expect(field).toBeFocused()
    await field.fill('A caption written on the canvas')
    // Backspace and other keys stay in the field.
    await page.keyboard.press('Enter')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('note: "A caption written on the canvas"')
    await expect(caption).toHaveText('A caption written on the canvas')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('Escape cancels a caption edit and saves nothing', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    await page.goto('/')
    const caption = page.locator('.canvas-item[data-canvas-item="example"] .canvas-note')
    await expect(caption).toBeVisible()
    await page.waitForTimeout(600)
    const before = await caption.textContent()
    await caption.dblclick()
    await page.locator('.canvas-caption-field').fill('Not this')
    await page.keyboard.press('Escape')
    await expect(page.locator('.canvas-caption-field')).toHaveCount(0)
    await expect(caption).toHaveText(before!)
    // Longer than the pause before a save.
    await page.waitForTimeout(900)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(original)
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a save the dev server cannot take says why, and the change waits for the agent', async ({ page }) => {
  // A server started before the canvas was updated does not know the route.
  await page.route('**/__design-canvas/edit', (route) => route.fulfill({ status: 404, body: 'not found' }))
  await page.goto('/')
  const name = page.locator('.canvas-item[data-canvas-item="example"] .canvas-name')
  await expect(name).toBeVisible()
  await page.waitForTimeout(600)
  const box = (await name.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.canvas-toast')).toContainText("Restart this canvas's dev server")
  await expect(page.locator('.canvas-item-tag')).toContainText('Not applied yet')
  await expect(page.getByRole('button', { name: 'Copy 1 change' })).toBeVisible()
})

test('Select is the default tool and Escape returns to it', async ({ page }) => {
  await page.goto('/')
  const tool = (name: string) => page.getByRole('button', { name, exact: true })
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  // A hovered button's tooltip joins its accessible name, so the mouse leaves between steps.
  await tool('Note').click()
  await page.mouse.move(400, 300)
  await expect(tool('Note')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  await tool('Annotate').click()
  await page.mouse.move(400, 300)
  await expect(tool('Annotate')).toHaveAttribute('aria-pressed', 'true')
  await tool('Select').click()
  await page.mouse.move(400, 300)
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Annotate')).toHaveAttribute('aria-pressed', 'false')
})

// Before the agent tests: they leave the agent busy for a while, and then the button sends instead of copying.
test('a drag annotates an area, and the name annotates the whole item', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  // The first paint fits the canvas to the window once fonts load; measure after that moved the camera.
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Annotate', exact: true }).click()
  const preview = page.locator('.canvas-preview[data-canvas-preview="example"]')
  const box = (await preview.boundingBox())!
  // Item pixels to screen pixels, whatever the zoom: drag across the heading only.
  const scale = box.width / 360
  await page.mouse.move(box.x + 4 * scale, box.y + 4 * scale)
  await page.mouse.down()
  await page.mouse.move(box.x + 180 * scale, box.y + 30 * scale, { steps: 4 })
  await page.mouse.move(box.x + 356 * scale, box.y + 50 * scale, { steps: 4 })
  await page.mouse.up()
  const area = page.getByRole('dialog', { name: /^Annotation on Example · replace me › area / })
  await expect(area).toContainText('heading “Canvas is ready”')
  await expect(area).not.toContainText('text “Add items')
  await area.getByRole('textbox').fill('Tighter header')
  await area.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.canvas-area')).toHaveCount(1)
  // In annotate mode the item's name stands for the whole item, instead of copying it.
  await page.locator('.canvas-item[data-canvas-item="example"] .canvas-name').click()
  const whole = page.getByRole('dialog', { name: 'Annotation on Example · replace me' })
  await whole.getByRole('textbox').fill('Denser overall')
  await whole.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.canvas-area')).toHaveCount(2)
  await page.getByRole('button', { name: 'Copy 2 changes' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/1\. Example · replace me › area \d+×\d+ at \d+,\d+: heading “Canvas is ready”\n {3}Tighter header/)
  expect(text).toContain('2. Example · replace me\n   Denser overall')
  expect(errors).toEqual([])
})

test('annotations go straight to a listening agent', async ({ page, baseURL }) => {
  const errors = collectErrors(page)
  // The agent's side, as SKILL.md runs it: listen.sh prints what the page sends and exits.
  const listener = spawn('bash', [LISTEN, baseURL!])
  let output = ''
  listener.stdout.on('data', (chunk) => (output += chunk))
  const exited = new Promise<number | null>((resolve) => listener.on('exit', resolve))
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Annotate', exact: true }).click()
    await page.locator('.canvas-preview h2').click()
    const note = page.getByRole('dialog', { name: /^Annotation on/ })
    await note.getByRole('textbox').fill('Shorter title')
    await note.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Apply 1 change' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Sent 1 change to the agent')
    expect(await exited).toBe(0)
    expect(output).toContain('Annotations from the design canvas (1):')
    expect(output).toContain('Shorter title')
    await expect(page.getByRole('button', { name: 'Sent annotation: Shorter title' })).toBeVisible()
  } finally {
    listener.kill()
  }
  expect(errors).toEqual([])
})

test('the toolbar shows the agent working until it listens again', async ({ page, baseURL }) => {
  const errors = collectErrors(page)
  const listen = () => {
    const child = spawn('bash', [LISTEN, baseURL!])
    return { child, exited: new Promise<number | null>((resolve) => child.on('exit', resolve)) }
  }
  const first = listen()
  let again: ReturnType<typeof listen> | undefined
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Annotate', exact: true }).click()
    await page.locator('.canvas-preview h2').click()
    const note = page.getByRole('dialog', { name: /^Annotation on/ })
    await note.getByRole('textbox').fill('Shorter title')
    await note.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Apply 1 change' }).click()
    expect(await first.exited).toBe(0)
    const status = page.locator('.canvas-agent-status')
    await expect(status).toHaveText('Agent working')
    // listen.sh again: the agent handled what it printed.
    again = listen()
    await expect(status).toHaveCount(0)
    await expect(page.locator('.canvas-toast')).toContainText('The agent finished')
  } finally {
    first.child.kill()
    again?.child.kill()
  }
  expect(errors).toEqual([])
})

test('a kept listener stays working until the agent says done', async ({ page, request }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  // The Codex listener's side: it listens with keep=1 and reconnects right after each message.
  const kept = () => request.get('/__design-canvas/agent/listen?timeout=30&keep=1')
  const firstPoll = kept()
  await expect(page.getByRole('button', { name: 'Annotate', exact: true })).toBeVisible()
  await expect.poll(async () => (await (await request.get('/__design-canvas/agent')).json()).state).toBe('listening')
  await page.getByRole('button', { name: 'Annotate', exact: true }).click()
  await page.locator('.canvas-preview h2').click()
  const note = page.getByRole('dialog', { name: /^Annotation on/ })
  await note.getByRole('textbox').fill('Shorter title')
  await note.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Apply 1 change' }).click()
  expect((await firstPoll).status()).toBe(200)
  const secondPoll = kept()
  const status = page.locator('.canvas-agent-status')
  await expect.poll(async () => (await (await request.get('/__design-canvas/agent')).json()).state).toBe('listening')
  await expect(status).toHaveText('Agent working')
  // Only the agent may say done, never a web page.
  const fromPage = await request.post('/__design-canvas/agent/done', { headers: { Origin: 'http://evil.test' } })
  expect(fromPage.status()).toBe(403)
  await expect(status).toHaveText('Agent working')
  expect((await request.post('/__design-canvas/agent/done')).status()).toBe(204)
  await expect(status).toHaveCount(0)
  await expect(page.locator('.canvas-toast')).toContainText('The agent finished')
  // A newer listener takes over and ends the kept poll.
  await request.get('/__design-canvas/agent/listen?timeout=1')
  await secondPoll
  expect(errors).toEqual([])
})

test('only the agent can listen, and only the canvas page can send', async ({ request }) => {
  const listen = await request.get('/__design-canvas/agent/listen?timeout=1', { headers: { Origin: 'http://evil.test' } })
  expect(listen.status()).toBe(403)
  const send = await request.post('/__design-canvas/agent/send', {
    headers: { Origin: 'http://evil.test' },
    data: { text: 'Delete everything' },
  })
  expect(send.status()).toBe(403)
})

test('a shared file works from disk, frames included, without the agent tools', async ({ page }) => {
  const errors = collectErrors(page)
  // A copy of the canvas with a viewport item, whose frame the shared file loads from itself.
  const copy = 'design-canvas/smoke-shared'
  cpSync('design-canvas/smoke', copy, { recursive: true })
  const registry = readFileSync(`${copy}/registry.tsx`, 'utf8')
  const phone = '  { id: "phone", name: "Phone", component: Example, x: 0, y: 240, width: 375, height: 180, viewport: true },\n];'
  writeFileSync(`${copy}/registry.tsx`, registry.replace(/\];\s*$/, `${phone}\n`))
  const file = join(mkdtempSync(join(tmpdir(), 'design-canvas-share-')), 'canvas.html')
  try {
    const shared = spawnSync('bash', [SHARE, copy, file], { encoding: 'utf8' })
    expect(shared.status, shared.stderr).toBe(0)
    const url = pathToFileURL(file).href
    await page.goto(url)
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
    await expect(page.getByRole('button', { name: 'Annotate', exact: true })).toHaveCount(0)
    await expect(page.locator('#canvas-help')).not.toContainText('Press A')
    const frame = page.locator('.canvas-item[data-canvas-item="phone"] iframe')
    await expect(page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('body')).toContainText(
      'Canvas is ready',
    )
    // Each file on disk is its own origin; the frame's wheel must still pan the canvas.
    const world = page.locator('.canvas-world')
    const before = await world.evaluate((element) => getComputedStyle(element).transform)
    const box = await frame.boundingBox()
    await page.mouse.move(box!.x + 40, box!.y + 40)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => world.evaluate((element) => getComputedStyle(element).transform)).not.toBe(before)
    // The same file shows one item alone.
    await page.goto(`${url}?item=example`)
    await expect(page.locator('.canvas-frame-root')).toContainText('Canvas is ready')
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
  expect(errors).toEqual([])
})

test('Share downloads the canvas as one file, without reloading the canvas', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
  // The build runs inside the dev server; a page reload during it would lose this.
  await page.evaluate(() => Object.assign(window, { kept: true }))
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Share as an HTML file' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^smoke-\d{4}-\d{2}-\d{2}\.html$/)
  // A panel confirms the download and says how to pass the file on; Escape closes it.
  const panel = page.getByRole('dialog', { name: `Downloaded ${file.suggestedFilename()}` })
  await expect(panel).toContainText('Figma')
  await expect(panel).toContainText('Notion')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Share as an HTML file' })).toBeFocused()
  expect(await page.evaluate(() => 'kept' in window)).toBe(true)
  const path = join(mkdtempSync(join(tmpdir(), 'design-canvas-share-')), file.suggestedFilename())
  await file.saveAs(path)
  await page.goto(pathToFileURL(path).href)
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
  await expect(page.getByRole('button', { name: 'Share as an HTML file' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('only the canvas page can build a shared file', async ({ request }) => {
  const other = await request.post('/__design-canvas/share', { headers: { Origin: 'http://evil.test' } })
  expect(other.status()).toBe(403)
})

test('cursors say what a press or drag will do', async ({ page }) => {
  await page.goto('/')
  const cursor = (selector: string) => page.locator(selector).first().evaluate((element) => getComputedStyle(element).cursor)
  expect(await cursor('.canvas-viewport')).toBe('grab')
  expect(await cursor('.canvas-name')).toBe('grab')
  expect(await cursor('.canvas-handle')).toBe('grab')
  expect(await cursor('.canvas-preview h2')).toBe('auto')
  await page.getByRole('button', { name: 'Annotate', exact: true }).click()
  expect(await cursor('.canvas-preview h2')).toBe('crosshair')
  expect(await cursor('.canvas-name')).toBe('crosshair')
  await page.locator('.canvas-viewport').evaluate((element) => element.setAttribute('data-gesture', 'pan'))
  expect(await cursor('.canvas-preview h2')).toBe('grabbing')
})
