import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test as base, expect, type Page } from '@playwright/test'

const LISTEN = fileURLToPath(new URL('../../skills/design-canvas/scripts/listen.sh', import.meta.url))
const SHARE = fileURLToPath(new URL('../../skills/design-canvas/scripts/share.sh', import.meta.url))
const REPLY = fileURLToPath(new URL('../../skills/design-canvas/scripts/reply.sh', import.meta.url))

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

const REGISTRY = 'design-canvas/smoke/registry.tsx'
const EXAMPLE = 'design-canvas/smoke/items/Example.tsx'
// The registry as installed. Every test starts from it.
const INSTALLED = readFileSync(REGISTRY, 'utf8')

// After each test, its pages are closed, every registry write they sent is done, and
// the registry is as installed. A canvas save still on its way when a test ended used
// to land during the next one: that test lost what it had just written, or the tests
// after it kept the items it had added.
const test = base.extend<{ settledRegistry: void }>({
  settledRegistry: [
    async ({ context, request, baseURL }, use, testInfo) => {
      const sent: Promise<unknown>[] = []
      context.on('request', (r) => {
        if (r.method() === 'POST' && r.url().includes('/__design-canvas/edit')) sent.push(r.response().catch(() => null))
      })
      await use()
      for (const page of context.pages()) await page.close()
      await Promise.race([Promise.all(sent), new Promise((resolve) => setTimeout(resolve, 5_000))])
      // The dev server makes registry writes one at a time, so once this one is answered,
      // every write sent before it is done. It names no item, so it writes nothing.
      await request.post('/__design-canvas/edit', {
        headers: { Origin: new URL(baseURL!).origin },
        data: { edits: [{ kind: 'item', id: 'no-such-item', set: { x: 0 } }] },
      })
      if (readFileSync(REGISTRY, 'utf8') === INSTALLED) return
      console.log(`"${testInfo.title}" left registry.tsx changed; it is back as installed.`)
      const served = await (await request.get('/registry.tsx')).text()
      writeFileSync(REGISTRY, INSTALLED)
      // So the next test's page loads it, not the version before. A change only in comments
      // can serve the same module, which is fine to load.
      await expect
        .poll(async () => (await (await request.get('/registry.tsx')).text()) !== served, { timeout: 5_000 })
        .toBe(true)
        .catch(() => {})
    },
    { auto: true },
  ],
})

// The dev server writes moves and new notes into registry.tsx. Tests about the
// agent path need the write refused, which is what makes a change fall back to
// the agent; refusing it also leaves the registry as installed for the tests after.
// Puts the registry back as installed and waits for the page to take that update, so
// it cannot land during the next test.
async function restoreRegistry(page: Page, original: string) {
  if (readFileSync(REGISTRY, 'utf8') === original) return
  const served = await (await page.request.get('/registry.tsx')).text()
  const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
  writeFileSync(REGISTRY, original)
  await updated
  // Also until the dev server serves it: the file is back, so the settledRegistry fixture has
  // nothing to do, and on a slow machine the next test's page could still load the version
  // before (an item in the trash, say), as GitHub's smoke job once did.
  await expect
    .poll(async () => (await (await page.request.get('/registry.tsx')).text()) !== served, { timeout: 10_000 })
    .toBe(true)
    .catch(() => {})
}

// Whether the dev server serves the registry with an item in the trash. A write lands in the
// file before the server sees it; a page loaded or updated after this check gets what it says.
async function servesTrashed(page: Page) {
  return (await (await page.request.get('/registry.tsx')).text()).includes('trashed: true')
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

// The fixture app sets `body { color }` (src/index.css), as many apps do. Text in a preview with
// no color of its own must take it, as in the app, and not the canvas chrome's.
const APP_TEXT = 'rgb(29, 53, 87)'
const CHROME_TEXT = 'rgb(31, 35, 40)'
const DARK_CHROME_TEXT = 'rgb(232, 234, 237)'

test("text in a preview has the app's color, on any background and opened alone, and the chrome keeps its own", async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      REGISTRY,
      original.replace(/\];\s*$/, '  { id: "phone", name: "Phone", component: Example, x: 0, y: 240, width: 375, height: 180, viewport: true },\n];\n'),
    )
    await servesId(page, 'phone')
    await page.goto('/')
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    const phone = page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('h2')
    await expect(item.locator('h2')).toHaveCSS('color', APP_TEXT)
    await expect(phone).toHaveCSS('color', APP_TEXT)
    await expect(item.locator('.canvas-name')).toHaveCSS('color', CHROME_TEXT)
    // A dark board turns the chrome light; the previews stay as the app draws them.
    await page.getByRole('button', { name: 'Canvas settings' }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(item.locator('.canvas-name')).toHaveCSS('color', DARK_CHROME_TEXT)
    await expect(item.locator('h2')).toHaveCSS('color', APP_TEXT)
    await expect(phone).toHaveCSS('color', APP_TEXT)
    await page.goto('/frame.html?item=example')
    await expect(page.locator('.canvas-frame-root h2')).toHaveCSS('color', APP_TEXT)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a planned direction shows as a card with a sketch, and its own buttons build or drop it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const original = readFileSync(REGISTRY, 'utf8')
  // The card's text and sketch sit inside the entry, braces, tags and quotes included; a save must still find the entry's own fields.
  const withPlan = original
    .replace('import { Example }', 'import { Block, planned } from "./canvas/Planned";\nimport { Example }')
    .replace(
      'export const registry: CanvasItem[] = [',
      `export const registry: CanvasItem[] = [
  {
    id: "grouped",
    name: "Inbox · grouped by matter",
    component: planned({
      bet: "People think in matters, so group by matter {first}.",
      givesUp: "Doesn't show the newest on top.",
      reference: "Another product's triage view",
      sketch: (
        <Block row>
          <Block size="40%" label="Matters" lines={3} />
          <Block label="Requests in it" emphasis lines={2}>
            <Block size={8} row>
              <Block label="Approve" />
            </Block>
          </Block>
        </Block>
      ),
    }),
    x: 420,
    y: 0,
    width: 360,
    height: 420,
  },`,
    )
  expect(withPlan).toContain('planned({')
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, withPlan)
    await expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('grouped')).toBe(true)
    await page.goto('/')
    const card = page.locator('.canvas-item[data-canvas-item="grouped"]')
    await expect(card.locator('[data-canvas-planned]')).toContainText('Planned, not built yet')
    await expect(card).toContainText('People think in matters')
    await expect(card).toContainText("Doesn't show the newest on top.")
    await expect(card).toContainText("Another product's triage view")
    await expect(card.locator('[data-canvas-sketch]')).toContainText('Requests in it')
    // A block given a size smaller than its label grows to show it.
    const approve = card.locator('[data-canvas-sketch]').getByText('Approve')
    const label = (await approve.boundingBox())!
    const block = (await approve.locator('..').boundingBox())!
    expect(block.height).toBeGreaterThanOrEqual(label.height)
    // Build asks for this card in place and goes out at once; with no agent listening it is copied.
    await card.getByRole('button', { name: 'Build this', exact: true }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Copied 1 for the agent')
    await expect(card).toContainText('Asked the agent to build this')
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain('1. Inbox · grouped by matter\n   Build this planned direction')
    expect(text).not.toContain('Keep the original')
    // A second press after a reload adds no second note.
    await page.reload()
    await card.getByRole('button', { name: 'Build this', exact: true }).click()
    await expect(card).toContainText('Asked the agent to build this')
    await expect(card.locator('.canvas-pin')).toHaveCount(1)
    // Drop is the ordinary trash, written into the card's own entry.
    await page.reload()
    await card.getByRole('button', { name: 'Drop', exact: true }).click()
    await expect(card).toHaveCount(0)
    await expect(page.locator('.canvas-toast')).toContainText('Moved Inbox · grouped by matter to the trash')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toMatch(/\{\s*trashed: true,\s*id: "grouped"/)
    expect(readFileSync(REGISTRY, 'utf8')).toContain('<Block size="40%" label="Matters" lines={3} />')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
    // Its own page shows the card without the buttons: nothing there could act on them.
    await page.goto('/frame.html?item=grouped')
    await expect(page.locator('[data-canvas-planned]')).toContainText('People think in matters')
    await expect(page.getByRole('button', { name: 'Build this', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test("a planned card's sketch draws shapes people recognize, marks the key change once, and keeps a small screen's width", async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const withPlan = original
    .replace('import { Example }', 'import { Block, planned } from "./canvas/Planned";\nimport { Example }')
    .replace(
      'export const registry: CanvasItem[] = [',
      `export const registry: CanvasItem[] = [
  {
    id: "one-page",
    name: "Upgrade · pay on the plan page",
    component: planned({
      bet: "Pay on the plan page, so there is one step less.",
      sketch: (
        <Block>
          <Block kind="heading" label="Upgrade" />
          <Block row>
            <Block size="45%">
              <Block kind="toggle" options={["Monthly", "Yearly"]} selected={1} />
              <Block kind="choice" label="Team" checked />
              <Block kind="list" options={["Shared spaces", "Roles"]} />
            </Block>
            <Block label="Payment" emphasis>
              <Block emphasis>
                <Block kind="field" label="Card number" />
              </Block>
              <Block kind="table" options={["Plan", "Price"]} rows={1} />
              <Block kind="media" label="Chart" size={40} />
              <Block kind="button" primary label="Pay $60" />
            </Block>
          </Block>
        </Block>
      ),
    }),
    x: 420,
    y: 0,
    width: 960,
    height: 560,
  },`,
    )
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, withPlan)
    await servesId(page, 'one-page')
    await page.goto('/frame.html?item=one-page')
    const sketch = page.locator('[data-canvas-sketch]')
    for (const words of ['Upgrade', 'Monthly', 'Yearly', 'Team', 'Shared spaces', 'Payment', 'Card number', 'Plan', 'Price', 'Chart', 'Pay $60']) {
      await expect(sketch.getByText(words, { exact: true })).toBeVisible()
    }
    // A key change inside a key change adds no second tag.
    await expect(sketch.getByText('Key change', { exact: true })).toHaveCount(1)
    // The sketch keeps a small screen's width on a desktop-sized card, and the words sit beside it.
    const box = (await sketch.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(460)
    const bet = (await page.getByText('Pay on the plan page, so there is one step less.').boundingBox())!
    expect(bet.x).toBeGreaterThan(box.x + box.width)
    // Nothing in the sketch is cut off: every shape fits inside it.
    const pay = (await sketch.getByText('Pay $60', { exact: true }).boundingBox())!
    expect(pay.y + pay.height).toBeLessThanOrEqual(box.y + box.height)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

// Three versions side by side for the pick tests: the example at 0,0 and two more beside it.
const withVersions = (source: string, extra = '') =>
  source.replace(
    /\];\s*$/,
    `  { id: "b", name: "Version B", component: Example, x: 400, y: 0, width: 360, height: 180 },
  { id: "c", name: "Version C", component: Example, x: 800, y: 0, width: 360, height: 220 },
${extra}];
`,
  )
const servesId = async (page: Page, id: string) =>
  expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes(`id: "${id}"`), { timeout: 15_000 }).toBe(true)
// The section a pick makes, as the registry holds it. Anchored to a line of its own:
// the installed registry's comment shows an example entry with the same id.
const setAsideFrames = () =>
  [...readFileSync(REGISTRY, 'utf8').matchAll(/^\s+\{ id: "set-aside", title: "Set aside", x: (-?\d+), y: (-?\d+), width: (\d+), height: (\d+) \},?$/gm)].map(
    (m) => m.slice(1).map(Number) as [number, number, number, number],
  )
const entryOf = (id: string) => {
  const source = readFileSync(REGISTRY, 'utf8')
  const at = source.indexOf(`id: "${id}"`)
  return source.slice(source.lastIndexOf('{', at), source.indexOf('}', at) + 1)
}

test('picking a version marks it and sets the others aside in one step, and Undo takes all of it back', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const three = withVersions(original)
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, three)
    await servesId(page, 'c')
    await page.goto('/')
    const item = (id: string) => page.locator(`.canvas-item[data-canvas-item="${id}"]`)
    await expect(item('c')).toBeVisible()
    await page.waitForTimeout(400)
    const before = (await item('example').boundingBox())!
    await page.getByRole('button', { name: 'Pick Version B and set the others aside' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Picked Version B. Set 2 others aside.')
    // The mark shows at once, and the picked version stays where it was.
    await expect(item('b')).toHaveAttribute('data-picked', 'true')
    // In the item's one status slot, a tab hanging from the card's bottom edge, with no "Saving…" beside the moved ones.
    const pickedTag = item('b').locator('.canvas-item-tag[data-state="picked"]')
    await expect(pickedTag).toHaveText('Picked')
    await expect(page.locator('.canvas-item-tag')).toHaveCount(1)
    const card = (await page.locator('[data-canvas-preview="b"]').boundingBox())!
    const tab = (await pickedTag.boundingBox())!
    expect(Math.abs(tab.y - (card.y + card.height))).toBeLessThan(3)
    expect(tab.x + tab.width).toBeLessThanOrEqual(card.x + card.width)
    expect(tab.x).toBeGreaterThan(card.x + card.width / 2)
    // One write: the mark, one section for the others, and their new places in it, in reading order.
    await expect.poll(() => entryOf('b')).toContain('picked: true')
    expect(setAsideFrames()).toHaveLength(1)
    const [frameX, frameY, frameW, frameH] = setAsideFrames()[0]!
    const place = (id: string) => ({ x: Number(/\bx: (-?\d+)/.exec(entryOf(id))![1]), y: Number(/\by: (-?\d+)/.exec(entryOf(id))![1]) })
    expect(place('b')).toEqual({ x: 400, y: 0 })
    expect(place('example').y).toBe(place('c').y)
    expect(place('example').x).toBeLessThan(place('c').x)
    // Below everything that was on the canvas, and inside the frame.
    expect(frameY).toBeGreaterThan(220 + 48)
    for (const [id, width, height] of [['example', 360, 180], ['c', 360, 220]] as const) {
      expect(place(id).x).toBeGreaterThanOrEqual(frameX)
      expect(place(id).x + width).toBeLessThanOrEqual(frameX + frameW)
      expect(place(id).y).toBeGreaterThanOrEqual(frameY)
      expect(place(id).y + 48 + height).toBeLessThanOrEqual(frameY + frameH)
    }
    await expect(page.locator('.canvas-section-tab')).toHaveText('Set aside')
    // The others glide to the section, so their place is asked until they have arrived.
    await expect.poll(async () => (await item('example').boundingBox())!.y).toBeGreaterThan(before.y + 100)
    // Set aside, they are out of the running: no pick is offered on them, and none on the picked one.
    await expect(page.getByRole('button', { name: /^Pick / })).toHaveCount(0)
    // The toast's Undo is the whole pick: the registry reads as it did before.
    await page.locator('.canvas-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(three)
    await expect(item('b')).not.toHaveAttribute('data-picked', 'true')
    await expect(page.locator('.canvas-section-tab')).toHaveCount(0)
    await expect.poll(async () => Math.round((await item('example').boundingBox())!.y)).toBe(Math.round(before.y))
    // Picked again, ⌘/Ctrl + Z does the same.
    await page.getByRole('button', { name: 'Pick Version C and set the others aside' }).click()
    await expect.poll(() => entryOf('c')).toContain('picked: true')
    await page.locator('.canvas-viewport').focus()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(three)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a later pick sets the earlier one aside too, in the same section', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, withVersions(original))
    await servesId(page, 'c')
    await page.goto('/')
    const item = (id: string) => page.locator(`.canvas-item[data-canvas-item="${id}"]`)
    await expect(item('c')).toBeVisible()
    await page.getByRole('button', { name: 'Pick Version B and set the others aside' }).click()
    await expect.poll(() => entryOf('b')).toContain('picked: true')
    const first = setAsideFrames()[0]!
    // The agent adds a new version beside the picked one; the person likes it better.
    writeFileSync(
      REGISTRY,
      readFileSync(REGISTRY, 'utf8').replace(/\];\s*$/, '  { id: "d", name: "Version D", from: "b", component: Example, x: 800, y: 0, width: 360, height: 180 },\n];\n'),
    )
    await servesId(page, 'd')
    await expect(item('d')).toBeVisible()
    // The canvas places the new version at the right end of the row, where its header can sit
    // under the top bar on a small screen. Pan it clear, as the person would.
    await page.mouse.move(640, 600)
    await page.mouse.wheel(400, -200)
    await page.getByRole('button', { name: 'Pick Version D and set the others aside' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Picked Version D. Set 1 other aside.')
    await expect.poll(() => entryOf('d')).toContain('picked: true')
    // The earlier pick loses its mark and joins the row at its right end; the frame grows, and there is still one.
    expect(entryOf('b')).not.toContain('picked')
    expect(setAsideFrames()).toHaveLength(1)
    const second = setAsideFrames()[0]!
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).toBeGreaterThan(first[2])
    const xOf = (id: string) => Number(/\bx: (-?\d+)/.exec(entryOf(id))![1])
    expect(xOf('b')).toBeGreaterThan(xOf('c') + 360)
    expect(xOf('b') + 360).toBeLessThanOrEqual(second[0] + second[2])
    await expect(item('b')).not.toHaveAttribute('data-picked', 'true')
    await expect(item('d')).toHaveAttribute('data-picked', 'true')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a pick inside a section leaves the items outside it where they are', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    // The example and B share a section; C sits outside it.
    const grouped = withVersions(original).replace(
      'export const sections: CanvasSection[] = [];',
      'export const sections: CanvasSection[] = [\n  { id: "cards", title: "Cards", x: -20, y: -20, width: 800, height: 300 },\n];',
    )
    expect(grouped).toContain('id: "cards"')
    writeFileSync(REGISTRY, grouped)
    await servesId(page, 'cards')
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="c"]')).toBeVisible()
    await page.getByRole('button', { name: 'Pick Example · replace me and set the others aside' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Set 1 other aside.')
    await expect.poll(() => entryOf('example')).toContain('picked: true')
    expect(entryOf('c')).toContain('x: 800, y: 0')
    expect(entryOf('b')).not.toContain('y: 0,')
    // C was not part of that comparison, so it can still be picked among its own.
    await expect(page.getByRole('button', { name: 'Pick Version C and set the others aside' })).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a pick in a section inside a section sets the whole round aside, and the other sections go whole', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  // One round of directions: a section around it, and inside it a section for each tradeoff.
  // The example and B answer one tradeoff; C answers another and has a note beside it.
  const round = withVersions(original)
    .replace(
      'export const sections: CanvasSection[] = [];',
      `export const sections: CanvasSection[] = [
  { id: "round", title: "Round", x: -60, y: -140, width: 1280, height: 600 },
  { id: "speed", title: "Speed", x: -30, y: -80, width: 800, height: 380 },
  { id: "who", title: "Who", x: 780, y: -80, width: 410, height: 500 },
];`,
    )
    .replace('export const notes: CanvasNote[] = [];', 'export const notes: CanvasNote[] = [\n  { id: "why-c", text: "Why C", x: 800, y: 300, width: 200, height: 60 },\n];')
  expect(round).toContain('id: "who"')
  expect(round).toContain('id: "why-c"')
  const sectionAt = (id: string) => {
    const m = new RegExp(`^\\s+\\{ id: "${id}", title: "\\w+", x: (-?\\d+), y: (-?\\d+),`, 'm').exec(readFileSync(REGISTRY, 'utf8'))
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  }
  const placeOf = (id: string) => ({ x: Number(/\bx: (-?\d+)/.exec(entryOf(id))![1]), y: Number(/\by: (-?\d+)/.exec(entryOf(id))![1]) })
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, round)
    await servesId(page, 'why-c')
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="c"]')).toBeVisible()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Pick Version B and set the others aside' }).click()
    // The example beside it and C in the other section: the whole round, not only its own section.
    await expect(page.locator('.canvas-toast')).toContainText('Picked Version B. Set 2 others aside.')
    await expect.poll(() => entryOf('b')).toContain('picked: true')
    const [frameX, frameY, frameW, frameH] = setAsideFrames()[0]!
    expect(frameY).toBeGreaterThan(460)
    // The other section moves whole: its frame, its item, and its note by the same step, into "Set aside".
    const who = sectionAt('who')!
    const dx = who.x - 780
    const dy = who.y - -80
    expect(dy).toBeGreaterThan(400)
    expect(placeOf('c')).toEqual({ x: 800 + dx, y: 0 + dy })
    expect(readFileSync(REGISTRY, 'utf8')).toContain(`{ id: "why-c", text: "Why C", x: ${800 + dx}, y: ${300 + dy}`)
    expect(who.x).toBeGreaterThanOrEqual(frameX)
    expect(who.y).toBeGreaterThanOrEqual(frameY)
    expect(who.x + 410).toBeLessThanOrEqual(frameX + frameW)
    expect(who.y + 500).toBeLessThanOrEqual(frameY + frameH)
    // The example leaves its section on its own; the picked version's section and the round stay.
    expect(placeOf('example').y).toBeGreaterThanOrEqual(frameY)
    expect(sectionAt('speed')).toEqual({ x: -30, y: -80 })
    expect(sectionAt('round')).toEqual({ x: -60, y: -140 })
    // Dragging "Set aside" takes the section inside it along.
    await page.keyboard.press('Shift+Digit1')
    await page.waitForTimeout(600)
    const aside = page.locator('.canvas-section[data-board-id="set-aside"] .canvas-section-tab')
    await expect(aside).toBeVisible()
    const tab = (await aside.boundingBox())!
    await page.mouse.move(tab.x + 20, tab.y + tab.height / 2)
    await page.mouse.down()
    await page.mouse.move(tab.x + 60, tab.y + tab.height / 2 + 30, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => setAsideFrames()[0]![1]).not.toBe(frameY)
    const [movedX, movedY] = setAsideFrames()[0]!
    await expect.poll(() => sectionAt('who')).toEqual({ x: who.x + movedX - frameX, y: who.y + movedY - frameY })
    // One Undo for the drag, one for the pick: the registry reads as it did.
    await page.locator('.canvas-viewport').focus()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => setAsideFrames()[0]![1]).toBe(frameY)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(round)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a pick the registry cannot take leaves nothing half done', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const three = withVersions(original)
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, three)
    await servesId(page, 'c')
    await refuseSaves(page)
    await page.goto('/')
    const item = (id: string) => page.locator(`.canvas-item[data-canvas-item="${id}"]`)
    await expect(item('c')).toBeVisible()
    await page.waitForTimeout(400)
    const before = (await item('example').boundingBox())!
    await page.getByRole('button', { name: 'Pick Version B and set the others aside' }).click()
    await expect(page.locator('.canvas-toast')).toContainText("Couldn't save the pick")
    // No mark, no move, no section, and nothing waiting for the agent.
    await expect(item('b')).not.toHaveAttribute('data-picked', 'true')
    await expect.poll(async () => Math.round((await item('example').boundingBox())!.y)).toBe(Math.round(before.y))
    await expect(page.locator('.canvas-section-tab')).toHaveCount(0)
    await expect(page.locator('.canvas-item-tag')).toHaveCount(0)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(three)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('an item moves to the trash and is put back', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    await expect(item).toContainText('Canvas is ready')
    await page.getByRole('button', { name: 'More actions for Example · replace me' }).click()
    await page.getByRole('button', { name: 'Move Example · replace me to the trash' }).click()
    await expect(item).toHaveCount(0)
    // The trash is written into the registry, so the shared file and the next session have it.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toMatch(/\{\s*trashed: true,\s*id: "example"/)
    // So a reload keeps it.
    await expect.poll(() => servesTrashed(page)).toBe(true)
    await page.reload()
    await expect(item).toHaveCount(0)
    await page.getByRole('button', { name: 'Trash, 1 item' }).click()
    const trash = page.getByRole('dialog', { name: 'Trash' })
    // Each item is a card with its live thumbnail, in the app's colors, under the day it went in:
    // this browser kept the time across the reload.
    await expect(trash.locator('.canvas-trash-group-label').first()).toHaveText('Today')
    const card = trash.locator('.canvas-trash-card[data-trash-id="example"]')
    await expect(card.locator('.canvas-trash-stage')).toContainText('Canvas is ready')
    await expect(card.locator('.canvas-trash-stage h2')).toHaveCSS('color', APP_TEXT)
    // A click only opens it large, as its own page that takes clicks; Escape goes back to the cards, with that one marked.
    await card.getByRole('button', { name: /Example · replace me/ }).click()
    const opened = trash.getByRole('region', { name: 'Example · replace me' })
    await expect(opened.locator('iframe').contentFrame().getByText('Canvas is ready')).toBeVisible()
    await expect(opened.locator('.canvas-trash-real')).not.toHaveAttribute('inert')
    await expect(item).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(opened).toHaveCount(0)
    await expect(card).toHaveAttribute('data-current', '')
    await card.getByRole('button', { name: /Example · replace me/ }).click()
    await trash.getByRole('button', { name: 'Put back Example · replace me' }).click()
    await expect(item).toContainText('Canvas is ready')
    await expect(page.getByRole('button', { name: /^Trash/ })).toHaveCount(0)
    // Put back, the entry reads as it did before.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(original)
    await expect.poll(() => servesTrashed(page)).toBe(false)
    // The agent trashing it in source moves it to the trash on the open canvas, and taking that back returns it.
    // A source change right after the canvas's own write can wait out TRASH_WRITE_GRACE, hence the longer waits.
    writeFileSync(REGISTRY, original.replace('id: "example",', 'id: "example",\n    trashed: true,'))
    await expect(item).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Trash, 1 item' })).toBeVisible()
    writeFileSync(REGISTRY, original)
    await expect(item).toContainText('Canvas is ready', { timeout: 10_000 })
    await expect(page.getByRole('button', { name: /^Trash/ })).toHaveCount(0)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(original)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('an item in the trash can be set aside instead, and the trash stays open on the next one', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      REGISTRY,
      withVersions(original).replace('id: "b",', 'id: "b", trashed: true,').replace('id: "c",', 'id: "c", trashed: true,'),
    )
    await servesId(page, 'c')
    await page.goto('/')
    await page.getByRole('button', { name: 'Trash, 2 items' }).click()
    const trash = page.getByRole('dialog', { name: 'Trash' })
    await trash.locator('.canvas-trash-card').first().getByRole('button').click()
    const first = (await trash.locator('.canvas-trash-detail-name').textContent())!
    const firstId = first === 'Version B' ? 'b' : 'c'
    const secondId = firstId === 'b' ? 'c' : 'b'
    await trash.getByRole('button', { name: `Set aside ${first}` }).click()
    // The first one makes the frame, below everything, and leaves the trash; the trash shows the other one.
    await expect.poll(() => setAsideFrames()).toHaveLength(1)
    await expect.poll(() => entryOf(firstId)).not.toContain('trashed')
    await expect(trash.locator('.canvas-trash-detail-name')).toHaveText(secondId === 'b' ? 'Version B' : 'Version C')
    await expect(page.getByRole('button', { name: 'Trash, 1 item' })).toBeVisible()
    const frame = setAsideFrames()[0]!
    const xOf = (id: string) => Number(/\bx: (-?\d+)/.exec(entryOf(id))![1])
    const yOf = (id: string) => Number(/\by: (-?\d+)/.exec(entryOf(id))![1])
    expect(xOf(firstId)).toBeGreaterThan(frame[0])
    expect(yOf(firstId)).toBeGreaterThan(frame[1])
    expect(frame[1]).toBeGreaterThan(yOf('example'))
    // The last one joins the row at its right end, the frame grows, and the empty trash closes.
    await trash.getByRole('button', { name: /^Set aside Version/ }).click()
    await expect(trash).toHaveCount(0)
    await expect.poll(() => entryOf(secondId)).not.toContain('trashed')
    await expect.poll(() => setAsideFrames()[0]![2]).toBeGreaterThan(frame[2])
    expect(setAsideFrames()).toHaveLength(1)
    expect(xOf(secondId)).toBeGreaterThan(xOf(firstId))
    await expect(page.locator(`.canvas-item[data-canvas-item="${secondId}"]`)).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('the registry holds the trash: a trash saved in a browser never undoes it', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const trashed = original.replace('id: "example",', 'id: "example",\n    trashed: true,')
  const item = page.locator('.canvas-item[data-canvas-item="example"]')
  // Written while no canvas is open. The next page must not load before the dev server serves the change.
  const writeRegistry = async (source: string) => {
    writeFileSync(REGISTRY, source)
    await expect.poll(() => servesTrashed(page)).toBe(source.includes('trashed: true'))
  }
  // Saved from frame.html, which never saves a layout, so the canvas cannot overwrite it on its way out.
  const saveLayout = async (trash: string[], inRegistry: boolean) => {
    await page.goto('/frame.html?item=example')
    const doc = { version: 1, camera: { x: 0, y: 0, z: 1 }, positions: {}, trash, trashInRegistry: inRegistry || undefined }
    await page.evaluate((json) => localStorage.setItem('design-canvas:smoke', json), JSON.stringify(doc))
  }
  try {
    const errors = collectErrors(page)
    // A browser whose saved trash is empty, as another tab or browser may have, opens a registry with the item trashed.
    await writeRegistry(trashed)
    await saveLayout([], true)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Trash, 1 item' })).toBeVisible()
    await expect(item).toHaveCount(0)
    await page.waitForTimeout(1000)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(trashed)
    // A trash an older shell kept only in the browser is written into the registry on the next load.
    await page.goto('/frame.html?item=example')
    await writeRegistry(original)
    await saveLayout(['example'], false)
    await page.goto('/')
    await expect(item).toHaveCount(0)
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toMatch(/\{\s*trashed: true,\s*id: "example"/)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('the More menu copies the item name, so several versions can be named to the agent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'More actions for Example · replace me' }).click()
  await page.getByRole('button', { name: 'Copy the name Example · replace me' }).click()
  await expect(page.locator('.canvas-toast')).toContainText('Copied: Example · replace me')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Example · replace me')
  await expect(page.getByRole('button', { name: 'Copy the name Example · replace me' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('copied annotations ask for a new version by default', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  await page.locator('.canvas-preview h2').click()
  const note = page.getByRole('dialog', { name: /^Ask agent about/ })
  await expect(note.getByRole('checkbox', { name: 'Apply to a new version' })).toBeChecked()
  await note.getByRole('textbox').fill('Shorter title')
  // Enter keeps the note and closes it; the bar at the top sends it.
  await note.getByRole('textbox').press('Enter')
  await expect(note).toHaveCount(0)
  await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
  await expect(page.locator('.canvas-toast')).toContainText('Copied 1 for the agent')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Keep the original and add a new version: Example · replace me (1)')
  expect(errors).toEqual([])
})

test('a note is a conversation: the agent answers on its pin, and the person answers back', async ({ page, context, request, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const original = readFileSync(EXAMPLE, 'utf8')
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText())
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    await page.locator('.canvas-preview h2').click()
    const note = page.getByRole('dialog', { name: /^Ask agent about/ })
    // The field says both things it is for. With no agent listening, the note has one way on:
    // Done keeps it, and the bar at the top is the one place that copies, counting up as notes are kept.
    await expect(note.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask for a change, or ask why')
    await expect(note.getByRole('button')).toHaveCount(2)
    await expect(note.getByRole('button', { name: 'Done' })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Copy \d+ for agent$/ })).toHaveCount(0)
    await note.getByRole('textbox').fill('Why is this title so large?')
    // The bar counts the note while it is still being written.
    await expect(page.getByRole('button', { name: 'Copy 1 for agent' })).toBeVisible()
    // In place: such a note clears when its item changes, unless it has an answer.
    await note.getByRole('checkbox').uncheck()
    await note.getByRole('button', { name: 'Done' }).click()
    await expect(note).toHaveCount(0)
    await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Copied 1 for the agent')
    // Reopened, a sent note offers nothing to copy: Done only closes it.
    await page.getByRole('button', { name: /^Sent to the agent: Why is this title/ }).click()
    await expect(note.getByRole('button', { name: 'Done' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(note).toHaveCount(0)
    // Each entry ends with the id the agent answers to.
    const text = await clipboard()
    expect(text).toMatch(/^1\. Example · replace me › heading “Canvas is ready”\n {3}Why is this title so large\?\n {3}\(note [a-z0-9]+\)$/m)
    const id = /^ {3}\(note ([a-z0-9]+)\)$/m.exec(text)![1]!
    // A page in the browser cannot answer for the agent, and an id that is not one is refused.
    // (Sent with a browser's Origin header rather than from the page, where the refusal would count as a console error.)
    expect((await request.post(`/__design-canvas/agent/reply?id=${id}`, { data: 'x', headers: { Origin: new URL(baseURL!).origin } })).status()).toBe(403)
    expect((await request.post('/__design-canvas/agent/reply?id=no%20such', { data: 'x' })).status()).toBe(400)
    // The agent answers with the skill's script: plain words, quotes and other languages as they are.
    const answer = 'It is the page heading, so it follows the type scale ("見出し").\nSay if you want it one step smaller.'
    const sent = spawnSync('bash', [REPLY, baseURL!, id, answer], { encoding: 'utf8' })
    expect(sent.stderr).toBe('')
    expect(sent.stdout).toContain(`Replied on note ${id}.`)
    // Unread: the pin itself holds the answer's first line, as one shape. Nothing opens by itself.
    const pin = page.locator('.canvas-pin[data-reply]')
    const bubble = pin.locator('.canvas-pin-bubble')
    await expect(pin).toHaveAttribute('data-reply', 'unread')
    await expect(bubble.locator('.canvas-pin-says')).toHaveText('Agent: It is the page heading, so it follows the type scale ("見出し").')
    const head = (await bubble.locator('.canvas-pin-head').boundingBox())!
    const says = (await bubble.locator('.canvas-pin-says').boundingBox())!
    const whole = (await bubble.boundingBox())!
    expect(says.x).toBeGreaterThanOrEqual(head.x + head.width - 1)
    expect(says.x + says.width).toBeLessThanOrEqual(whole.x + whole.width + 1)
    await expect(note).toHaveCount(0)
    await expect(page.locator('.canvas-toast')).toContainText('The agent replied')
    // Opened, it reads as a comment thread: the person's words at the edge, the answer set in under them.
    await bubble.click()
    const turns = note.locator('.canvas-thread-turn')
    await expect(turns).toHaveCount(2)
    await expect(turns.nth(0).locator('.canvas-thread-who')).toHaveText('You')
    await expect(turns.nth(0).locator('.canvas-thread-text')).toHaveText('Why is this title so large?')
    // Only the agent's turns are set in by a rule: the person's own words need no mark.
    await expect(turns.nth(0)).toHaveCSS('border-left-width', '0px')
    await expect(turns.nth(1).locator('.canvas-thread-who')).toHaveText('Agent')
    await expect(turns.nth(1).locator('.canvas-thread-text')).toHaveText(answer)
    await expect(turns.nth(1)).toHaveCSS('border-left-width', '2px')
    // The note can be dragged out of the way by its top edge, for this time only.
    const placed = (await note.boundingBox())!
    const grip = (await note.locator('.canvas-annotation-handle').boundingBox())!
    await page.mouse.move(grip.x + 24, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + 144, grip.y + grip.height / 2 + 60, { steps: 5 })
    await page.mouse.up()
    const dragged = (await note.boundingBox())!
    expect(Math.abs(dragged.x - placed.x - 120)).toBeLessThan(2)
    expect(Math.abs(dragged.y - placed.y - 60)).toBeLessThan(2)
    await expect(note).toBeVisible()
    // The field under it is for an answer to the agent, and has no version choice until there are words.
    await expect(note.getByRole('textbox')).toHaveValue('')
    await expect(note.getByRole('textbox')).toHaveAttribute('placeholder', 'Reply to the agent')
    await expect(note.getByRole('checkbox')).toHaveCount(0)
    // Read, the pin goes quiet and stays read, also after closing with Escape and after a reload.
    await page.keyboard.press('Escape')
    await expect(pin).toHaveAttribute('data-reply', 'read')
    await expect(bubble.locator('.canvas-pin-says')).toHaveCount(0)
    await page.reload()
    await expect(pin).toHaveAttribute('data-reply', 'read')
    // The item changes: a sent note would clear, an answered one stays.
    writeFileSync(EXAMPLE, original.replace('Canvas is ready', 'Canvas is set'))
    await expect(page.locator('.canvas-preview h2')).toHaveText('Canvas is set', { timeout: 15_000 })
    await page.waitForTimeout(800)
    await expect(pin).toHaveAttribute('data-reply', 'read')
    // The person answers back on the same pin. The message carries the conversation, so it reads whole on its own.
    await bubble.click()
    await note.getByRole('textbox').fill('Then make it one step smaller')
    // ⌘/Ctrl + Enter copies everything from the note, without the trip to the bar.
    await note.getByRole('textbox').press('ControlOrMeta+Enter')
    expect(await clipboard()).toContain(
      `   Earlier on this note:\n   - Person: Why is this title so large?\n   - Agent (you): It is the page heading, so it follows the type scale ("見出し").\n     Say if you want it one step smaller.\n   Now: Then make it one step smaller\n   (note ${id})`,
    )
    await expect(page.locator('.canvas-pin[data-reply]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Sent to the agent: Then make it/ })).toHaveCount(1)
    // The old answer does not come back for the new words after a reload.
    await page.reload()
    await expect(page.locator('.canvas-pin')).toHaveCount(1)
    await expect(page.locator('.canvas-pin[data-reply]')).toHaveCount(0)
    // The agent answers again, and the thread has all four turns, in order.
    expect((await request.post(`/__design-canvas/agent/reply?id=${id}`, { data: 'I did not change it: one step smaller is the body size. Two sizes, in the chat.' })).status()).toBe(200)
    await expect(pin).toHaveAttribute('data-reply', 'unread')
    await bubble.click()
    await expect(turns).toHaveCount(4)
    await expect(turns.locator('.canvas-thread-who')).toHaveText(['You', 'Agent', 'You', 'Agent'])
    await expect(turns.nth(2).locator('.canvas-thread-text')).toHaveText('Then make it one step smaller')
    await expect(turns.nth(3).locator('.canvas-thread-text')).toContainText('I did not change it')
    // However long it gets, the thread shows whole: the note grows, and nothing inside it scrolls.
    expect(await note.locator('.canvas-thread').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    // Opened again, the note is back at its pin, not where it was dragged to.
    const reopened = (await note.boundingBox())!
    expect(Math.abs(reopened.x - placed.x)).toBeLessThan(2)
    expect(errors).toEqual([])
  } finally {
    if (readFileSync(EXAMPLE, 'utf8') !== original) {
      const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
      writeFileSync(EXAMPLE, original)
      await updated
    }
  }
})

test('an answer for a note that is gone is still said, once', async ({ page, request }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(400)
  expect((await request.post('/__design-canvas/agent/reply?id=gone1', { data: 'Done as asked, with one difference: the icon stays.' })).status()).toBe(200)
  await expect(page.locator('.canvas-toast')).toContainText('Agent: Done as asked, with one difference: the icon stays.')
  // The dev server still holds it, but a page that opens later does not repeat it.
  await page.reload()
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(600)
  await expect(page.locator('.canvas-toast')).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.canvas-toast')).toContainText("1 isn't sent yet")
  await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Add a note at')
  expect(text).toContain('Why this version')
  await expect(ghost).toContainText('Sent')
  expect(errors).toEqual([])
})

test('an open note card is drawn above a note lying over its item', async ({ page }) => {
  await refuseSaves(page)
  await page.goto('/')
  const preview = page.locator('.canvas-item[data-canvas-item="example"] .canvas-preview')
  await expect(preview).toBeVisible()
  // The first paint fits the canvas to the window once fonts load, later on a slow machine:
  // measure only once the item has stopped moving, and again before each press.
  const settled = async () => {
    let last = ''
    await expect
      .poll(async () => {
        const now = JSON.stringify(await preview.boundingBox())
        const same = now === last
        last = now
        return same
      })
      .toBe(true)
    return (await preview.boundingBox())!
  }
  let box = await settled()
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.mouse.click(box.x + 40, box.y + 40)
  await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
  await page.keyboard.type('Underneath')
  await page.keyboard.press('Escape')
  const ghost = (await page.locator('[data-board-ghost]').boundingBox())!
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  box = await settled()
  await page.mouse.click(box.x + 20, box.y + 110)
  const card = page.locator('.canvas-annotation-card')
  await expect(card).toBeVisible()
  const covered = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('.canvas-annotation-card') !== null,
    [ghost.x + ghost.width / 2, ghost.y + ghost.height / 2],
  )
  expect(covered).toBe(true)
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
  await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
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
  await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
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
  await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/Move “Example · replace me” \(id example\) to -?\d+,-?\d+/)
  await expect(tag).toContainText('Sent')
  // Putting it back where the registry has it ends the change.
  await tag.getByRole('button', { name: 'Discard this change' }).click()
  await expect(tag).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Copy \d+ for|Send \d+ to) agent/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Discard all drops everything not sent yet, and Undo brings it back', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Copy 2 for agent' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard all' }).click()
  // The toolbar shrinks when the button goes; keep the pointer off whatever slides under it.
  await page.mouse.move(640, 300)
  await expect(page.locator('.canvas-toast')).toContainText('Discarded 2')
  await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
  await expect(page.locator('.canvas-item-tag')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Copy \d+ for agent/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('[data-board-ghost]')).toContainText('Gone soon')
  await expect(page.locator('.canvas-item-tag')).toContainText('Not applied yet')
  await expect(page.getByRole('button', { name: 'Copy 2 for agent' })).toBeVisible()
  expect(errors).toEqual([])
})

test('an item sized by a spread is resized in the registry, after the spread', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  // Canvases often share one size object between items; a value written before the spread is overwritten by it.
  const spread = original
    .replace(/width: 360,\s*height: 180,/, '...SIZE,')
    .replace('export const registry', 'const SIZE = { width: 360, height: 180 };\n\nexport const registry')
  expect(spread).toContain('...SIZE,')
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, spread)
    await expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('SIZE')).toBe(true)
    await page.goto('/')
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    await expect(item).toContainText('Canvas is ready')
    await page.waitForTimeout(600)
    const before = (await item.boundingBox())!
    const edge = (await item.locator('.canvas-item-edge[data-edge="e"]').boundingBox())!
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2)
    await page.mouse.down()
    await page.mouse.move(edge.x + edge.width / 2 + 100, edge.y + edge.height / 2, { steps: 6 })
    await page.mouse.up()
    // Written after the spread, so it takes effect.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toMatch(/\.\.\.SIZE,\s*(height: 180,\s*)?width: (4\d\d),/)
    await expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).match(/width: 4\d\d/) !== null).toBe(true)
    await page.reload()
    await expect(item).toContainText('Canvas is ready')
    const after = (await item.boundingBox())!
    expect(after.width).toBeGreaterThan(before.width + 50)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
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
    await expect(page.getByRole('button', { name: /^(Copy \d+ for|Send \d+ to) agent/ })).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __samePage?: boolean }).__samePage)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a save says nothing unless it is overdue', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    // The write is held for four seconds, as on a machine that is slow or stuck.
    await page.route('**/__design-canvas/edit', async (route) => {
      if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 4000))
      await route.continue()
    })
    await page.goto('/')
    const name = page.locator('.canvas-item[data-canvas-item="example"] .canvas-name')
    await expect(name).toBeVisible()
    await page.waitForTimeout(600)
    const box = (await name.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 6 })
    await page.mouse.up()
    const tag = page.locator('.canvas-item-tag')
    // A save that goes through is done well within this time, and it would have shown nothing.
    await page.waitForTimeout(1500)
    await expect(tag).toHaveCount(0)
    // Still on its way: now the person is told their move is not in the registry yet.
    await expect(tag).toHaveText('Saving…', { timeout: 4000 })
    await expect(tag).toHaveCount(0, { timeout: 8000 })
    expect(readFileSync(REGISTRY, 'utf8')).not.toBe(original)
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
    await expect(page.getByRole('button', { name: /^(Copy \d+ for|Send \d+ to) agent/ })).toHaveCount(0)
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
    await expect(page.getByRole('button', { name: /^(Copy \d+ for|Send \d+ to) agent/ })).toHaveCount(0)
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
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
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
    await expect(page.getByRole('dialog', { name: /^Ask agent about Example · replace me › area / })).toHaveAccessibleName(/heading “Canvas is ready”/)
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

test('opening a canvas whose entries are written out shows no warning', async ({ page }) => {
  const checked = page.waitForResponse('**/__design-canvas/edit/check')
  await page.goto('/')
  expect(((await (await checked).json()) as { placeable: string[] }).placeable).toContain('example')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(400)
  await expect(page.locator('.canvas-toast')).toHaveCount(0)
})

test('opening a canvas with generated entries warns before the first drag', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  // An item built from a spread, like `...SIZE`, which a resize could not overwrite.
  writeFileSync(REGISTRY, original.replace('width: 360,', '...{ width: 360 },'))
  try {
    await page.goto('/')
    await expect(page.locator('.canvas-toast')).toContainText('example')
    await expect(page.locator('.canvas-toast')).toContainText('generated by code')
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a newer version shows one notice, and its button copies a request for the agent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/__design-canvas/version', (route) => route.fulfill({ json: { current: 13, latest: 99, folder: '/work/my-canvas' } }))
  await page.goto('/')
  const toast = page.locator('.canvas-toast')
  await expect(toast).toContainText('Version 99 of this canvas is out')
  await toast.getByRole('button', { name: 'Ask the agent to update' }).click()
  await expect(toast).toContainText('Paste it to the agent')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('scripts/update.sh')
  expect(copied).toContain('/work/my-canvas')
  // The same version is not offered again in this browser.
  await page.reload()
  await page.waitForTimeout(600)
  await expect(page.locator('.canvas-toast')).toHaveCount(0)
})

test('the dev server knows the canvas version', async ({ page }) => {
  await page.goto('/')
  const v = (await (await page.request.get('/__design-canvas/version')).json()) as { current: number | null; folder: string }
  expect(v.current).toBe(Number(readFileSync('../../skills/design-canvas/VERSION', 'utf8')))
  expect(v.folder).toContain('smoke')
})

test('a save never leaves the registry empty or half written', async ({ page, baseURL }) => {
  // The dev server puts the new text in place in one step. A plain write empties the file
  // first, and a hot update that reads it in that moment breaks the page until the next change.
  const original = readFileSync(REGISTRY, 'utf8')
  const save = (x: number) =>
    page.request.post('/__design-canvas/edit', {
      headers: { Origin: new URL(baseURL!).origin },
      data: { edits: [{ kind: 'item', id: 'example', set: { x } }] },
    })
  // Reads the file as fast as it can while the saves run, as a hot update might at any moment.
  let reading = true
  let reads = 0
  let broken = 0
  const read = () => {
    for (let i = 0; i < 200; i++) {
      reads++
      try {
        const text = readFileSync(REGISTRY, 'utf8')
        if (!text.includes('export const notes') || !text.trimEnd().endsWith('];')) broken++
      } catch {
        broken++
      }
    }
    if (reading) setImmediate(read)
  }
  try {
    read()
    for (let i = 0; i < 60; i++) expect((await save(10 + (i % 2) * 10)).status()).toBe(200)
    reading = false
    expect(reads).toBeGreaterThan(1000)
    expect(broken).toBe(0)
    // Nothing is left beside it, and the last save is what the file holds.
    expect(readdirSync(dirname(REGISTRY)).filter((name) => name.endsWith('.saving'))).toEqual([])
    expect(readFileSync(REGISTRY, 'utf8')).toMatch(/id: "example",[^}]*\bx: 20,/)
  } finally {
    reading = false
    await save(0)
    if (readFileSync(REGISTRY, 'utf8') !== original) writeFileSync(REGISTRY, original)
    await expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('x: 0,')).toBe(true)
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
  await expect(page.getByRole('button', { name: 'Copy 1 for agent' })).toBeVisible()
})

test('Undo (Cmd or Ctrl + Z) puts back a moved item in the registry', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    // The grip keeps focus after a nudge, and Undo works from there.
    await page.locator('.canvas-item[data-canvas-item="example"] .canvas-handle').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toBe(original)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(original)
    await expect(page.locator('.canvas-toast')).toContainText('Undone')
    // Nothing left to undo, and the item is not saved again.
    await page.waitForTimeout(900)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(original)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('Undo removes a note that was just saved', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Note', exact: true }).click()
    await page.mouse.click(700, 400)
    await expect(page.locator('[data-board-ghost] textarea')).toBeFocused()
    await page.keyboard.type('Undo me')
    await page.keyboard.press('Escape')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('text: "Undo me"')
    await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(original)
    await expect(page.locator('.canvas-note-card', { hasText: 'Undo me' })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('the zoom buttons and keys step between fixed levels', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(600)
  const zoom = page.locator('.canvas-zoom')
  await page.getByRole('button', { name: 'Reset view (actual size)' }).click()
  await expect(zoom).toHaveText('100%')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).toHaveText('200%')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).toHaveText('300%')
  // The limit holds.
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).toHaveText('300%')
  for (const level of ['200%', '100%', '50%', '25%', '10%', '5%', '2%', '2%']) {
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await expect(zoom).toHaveText(level)
  }
  // From between two levels, a press goes to the next one in its direction; the keys do the same.
  await page.mouse.move(400, 300)
  await page.locator('.canvas-viewport').focus()
  await page.keyboard.press('0')
  await page.keyboard.press('-')
  await expect(zoom).toHaveText('50%')
  await page.keyboard.press('=')
  await expect(zoom).toHaveText('100%')
  expect(errors).toEqual([])
})

test('Fit all takes in items far apart, below the old 10% limit', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    // Load first, then add the item, as the agent does: the canvas picks up the change.
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    // 30,000 px apart: at 10% a 1280 px wide view covers only 12,800 px.
    writeFileSync(
      REGISTRY,
      original.replace(
        /\];\s*$/,
        '  { id: "far", name: "Far", component: Example, x: 30000, y: 0, width: 360, height: 180 },\n];\n',
      ),
    )
    const far = page.locator('.canvas-item[data-canvas-item="far"]')
    await expect(far).toHaveCount(1, { timeout: 15_000 })
    await page.getByRole('button', { name: 'Fit all' }).click()
    const view = page.viewportSize()!
    for (const id of ['example', 'far']) {
      await expect
        .poll(async () => {
          const box = (await page.locator(`.canvas-item[data-canvas-item="${id}"]`).boundingBox())!
          return box.x >= 0 && box.x + box.width <= view.width && box.y >= 0 && box.y + box.height <= view.height
        })
        .toBe(true)
    }
    expect(Number((await page.locator('.canvas-zoom').textContent())!.replace('%', ''))).toBeLessThan(10)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('the help opens on a press, shows the controls in groups, and stays until it is closed', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  const button = page.getByRole('button', { name: 'Canvas controls' })
  const help = page.locator('#canvas-help')
  // Closed until asked for: hovering the button only shows its hint.
  await button.hover()
  await page.waitForTimeout(500)
  await expect(help).toBeHidden()
  await button.click()
  await expect(help).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  for (const title of ['Move around', 'Items', 'Ask the agent', 'Notes and sections']) {
    await expect(help.getByRole('heading', { name: title })).toBeVisible()
  }
  // A key is a key cap beside what it does.
  const row = help.locator('.canvas-help-row', { hasText: 'Start asking' })
  await expect(row.locator('kbd')).toHaveText('A')
  // It stays while the pointer is elsewhere, and fits in the window.
  await page.mouse.move(200, 300)
  await page.waitForTimeout(300)
  await expect(help).toBeVisible()
  const box = (await help.boundingBox())!
  const size = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(size.width)
  expect(box.y + box.height).toBeLessThanOrEqual(size.height)
  // Escape closes it; so does a press outside it, and the button again.
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
  await button.click()
  await expect(help).toBeVisible()
  await page.mouse.click(200, 300)
  await expect(help).toBeHidden()
  await button.click()
  await button.click()
  await expect(help).toBeHidden()
  expect(errors).toEqual([])
})

test('after a reload the canvas is at its saved view from the first frame', async ({ page }) => {
  const errors = collectErrors(page)
  // Where the world is in the first frame that has an item in it.
  await page.addInitScript(() => {
    const seen = new MutationObserver(() => {
      const world = document.querySelector('.canvas-world')
      if (!world?.querySelector('.canvas-item')) return
      seen.disconnect()
      requestAnimationFrame(() => {
        ;(window as unknown as { __firstFrame: string }).__firstFrame = getComputedStyle(world).transform
      })
    })
    seen.observe(document, { childList: true, subtree: true })
  })
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(600)
  // A view that is not the default one.
  await page.getByRole('button', { name: 'Reset view (actual size)' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.locator('.canvas-zoom')).toHaveText('200%')
  const saved = await page.locator('.canvas-world').evaluate((world) => getComputedStyle(world).transform)
  expect(saved).toMatch(/^matrix\(2, /)
  await page.reload()
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  // Not the default view first and the saved one a frame later: that showed as a jump.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __firstFrame?: string }).__firstFrame)).toBe(saved)
  await expect(page.locator('.canvas-zoom')).toHaveText('200%')
  expect(errors).toEqual([])
})

// A section around the example item, for the tests below. Waits for the page to take it.
/** A one-pixel PNG. */
const DOT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Two items side by side and a note under the first, for the tests that select several things. */
async function withBoard(page: Page, original: string) {
  const board = original
    .replace('export const notes: CanvasNote[] = [];', 'export const notes: CanvasNote[] = [\n  { id: "why", text: "Why A", x: 0, y: 300 },\n];')
    .replace(/\];\s*$/, '  { id: "second", name: "Second", component: Example, x: 480, y: 0, width: 360, height: 180 },\n];\n')
  expect(board).toContain('id: "why"')
  expect(board).toContain('id: "second"')
  writeFileSync(REGISTRY, board)
  await expect
    .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "second"'), { timeout: 15_000 })
    .toBe(true)
  await page.goto('/')
  const second = page.locator('.canvas-item[data-canvas-item="second"]')
  await expect(second).toBeVisible()
  await page.waitForTimeout(600)
  // On a dev server that has just started, the view is fitted and an item can be placed
  // again a moment after the page shows. Wait until everything has held still for a while,
  // so a press lands where it was measured.
  let last = ''
  let still = 0
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() =>
          [...document.querySelectorAll('.canvas-item, .canvas-note-card')].map((e) => JSON.stringify(e.getBoundingClientRect())).join(),
        )
        still = now === last ? still + 1 : 0
        last = now
        return still
      },
      { intervals: [300], timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(3)
  return board
}

test('a box drawn on empty canvas selects what it touches, and a drag moves them together with one Undo', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const board = await withBoard(page, original)
    const example = page.locator('.canvas-item[data-canvas-item="example"]')
    const second = page.locator('.canvas-item[data-canvas-item="second"]')
    const note = page.locator('.canvas-note-card[data-board-id="why"]')
    const a = (await example.boundingBox())!
    const b = (await second.boundingBox())!
    const n = (await note.boundingBox())!
    // A box around the first item and the note, wherever they sit, that stays clear of the second item.
    const left = Math.min(a.x, n.x) - 24
    const top = Math.min(a.y, n.y) - 24
    const right = Math.max(a.x + a.width, n.x + n.width) + 12
    const bottom = Math.max(a.y + a.height, n.y + n.height) + 12
    expect(b.x > right || b.x + b.width < left || b.y > bottom || b.y + b.height < top).toBe(true)
    await page.mouse.move(left, top)
    await page.mouse.down()
    await page.mouse.move(right, bottom, { steps: 8 })
    await expect(page.locator('.canvas-draw')).toBeVisible()
    // Selected as the box is drawn, before the button is let go.
    await expect(example).toHaveAttribute('data-selected', 'true')
    await page.mouse.up()
    await expect(page.locator('.canvas-draw')).toBeHidden()
    await expect(note).toHaveAttribute('data-selected', 'true')

    await expect(second).not.toHaveAttribute('data-selected')
    // The drag selected; it did not pan.
    expect((await example.boundingBox())!.x).toBe(a.x)
    // Several selected show no resize grips.
    await expect(note.locator('.canvas-resize').first()).toBeHidden()
    // Dragging one of them moves them all, and leaves the rest of the canvas.
    const name = (await example.locator('.canvas-name').boundingBox())!
    await page.mouse.move(name.x + 10, name.y + name.height / 2)
    await page.mouse.down()
    await page.mouse.move(name.x + 10, name.y + name.height / 2 + 90, { steps: 8 })
    await page.mouse.up()
    const movedItem = (await example.boundingBox())!.y - a.y
    expect(movedItem).toBeGreaterThan(60)
    const movedNote = (await page.locator('.canvas-note-card').first().boundingBox())!.y - n.y
    expect(Math.abs(movedNote - movedItem)).toBeLessThan(2)
    expect(Math.abs((await second.boundingBox())!.y - b.y)).toBeLessThan(1)
    // Both land in the registry, and the selection is kept once they are saved.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toContain('text: "Why A", x: 0, y: 300')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toMatch(/id: "example"[^}]*\by: 0,/)
    await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
    await expect(example).toHaveAttribute('data-selected', 'true')
    await expect(note).toHaveAttribute('data-selected', 'true')
    // One Undo for the one move.
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(board)
    // A click on empty canvas lets go.
    await page.mouse.click(left, top)
    await expect(page.locator('[data-selected]')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('Shift + click adds to the selection and takes out of it, and Delete removes several with one Undo', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await withBoard(page, original)
    const example = page.locator('.canvas-item[data-canvas-item="example"]')
    const second = page.locator('.canvas-item[data-canvas-item="second"]')
    const note = page.locator('.canvas-note-card[data-board-id="why"]')
    // A click on an item's name selects it alone.
    await example.locator('.canvas-name').click()
    await expect(example).toHaveAttribute('data-selected', 'true')
    await second.locator('.canvas-name').click()
    await expect(second).toHaveAttribute('data-selected', 'true')
    await expect(example).not.toHaveAttribute('data-selected')
    await note.click({ modifiers: ['Shift'] })
    await example.locator('.canvas-name').click({ modifiers: ['Shift'] })
    await expect(page.locator('[data-selected]')).toHaveCount(3)
    await second.locator('.canvas-name').click({ modifiers: ['Shift'] })
    await expect(second).not.toHaveAttribute('data-selected')
    await expect(page.locator('[data-selected]')).toHaveCount(2)
    // The item goes to the trash and the note leaves the registry, with one notice.
    await page.keyboard.press('Delete')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('trashed: true')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toContain('id: "why"')
    await expect(example).toHaveCount(0)
    await expect(note).toHaveCount(0)
    await expect(second).toBeVisible()
    await expect(page.locator('.canvas-toast')).toHaveCount(1)
    await expect(page.locator('.canvas-toast')).toContainText('Removed 2 from the canvas')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toContain('id: "why", text: "Why A", x: 0, y: 300')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toContain('trashed: true')
    await expect(example).toBeVisible()
    await expect(note).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a note draws **bold** and lists, and is edited as the text it is', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const text = 'We compared:\\n- **A** keeps the summary\\n- B hides it\\n\\n1. Pick one\\n2. Ship it\\n2 ** 3 ** 4'
    const noted = original.replace(
      'export const notes: CanvasNote[] = [];',
      `export const notes: CanvasNote[] = [\n  { id: "why", text: "${text}", x: 0, y: 300 },\n];`,
    )
    expect(noted).toContain('id: "why"')
    writeFileSync(REGISTRY, noted)
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "why"'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const note = page.locator('.canvas-note-card[data-board-id="why"]')
    await expect(note).toBeVisible()
    await expect(note.locator('ul > li')).toHaveText(['A keeps the summary', 'B hides it'])
    await expect(note.locator('ol > li')).toHaveText(['Pick one', 'Ship it'])
    // The app resets lists (src/index.css), and the note's still show their markers.
    await expect(note.locator('ul')).toHaveCSS('list-style-type', 'disc')
    await expect(note.locator('ol')).toHaveCSS('list-style-type', 'decimal')
    await expect(note.locator('strong')).toHaveText(['A'])
    // The marks are drawn, not shown; stars with spaces inside are no mark.
    await expect(note).not.toContainText('**A**')
    await expect(note).toContainText('2 ** 3 ** 4')
    // Editing shows the text as typed.
    await page.waitForTimeout(600)
    await note.dblclick()
    await expect(page.locator('[data-board-ghost] textarea')).toHaveValue(/^We compared:\n- \*\*A\*\* keeps the summary/)
    await page.keyboard.press('Escape')
    expect(readFileSync(REGISTRY, 'utf8')).toBe(noted)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a note draws links and `code`; a click opens a link, and a drag from it moves the note', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const long = 'https://www.example.com/design/AbCdEfGh/checkout-flow?node-id=12-34'
    const text = `See [the spec](https://example.com/spec) and ${long}. Then https://example.com/jaを見る\\nUse \`Button\` with **\`variant\` [here](https://example.com/b)**, not \`**raw**\`.`
    const noted = original.replace(
      'export const notes: CanvasNote[] = [];',
      `export const notes: CanvasNote[] = [\n  { id: "links", text: "${text}", x: 0, y: 300 },\n];`,
    )
    expect(noted).toContain('id: "links"')
    writeFileSync(REGISTRY, noted)
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "links"'), { timeout: 15_000 })
      .toBe(true)
    // The new tabs land here instead of the network.
    await page.context().route('https://example.com/**', (route) => route.fulfill({ body: 'linked' }))
    await page.context().route('https://www.example.com/**', (route) => route.fulfill({ body: 'linked' }))
    await page.goto('/')
    const note = page.locator('.canvas-note-card[data-board-id="links"]')
    await expect(note).toBeVisible()
    const links = note.locator('a.canvas-note-link')
    // A typed address shows short, without its full stop; Japanese right after it is not part of it.
    await expect(links).toHaveText(['the spec', 'example.com/design/AbCdEfGh/checkout-fl…', 'example.com/ja', 'here'])
    expect(await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')))).toEqual([
      'https://example.com/spec',
      long,
      'https://example.com/ja',
      'https://example.com/b',
    ])
    await expect(note).toContainText('checkout-fl…. Then')
    await expect(note).toContainText('を見る')
    await expect(note.locator('code')).toHaveText(['Button', 'variant', '**raw**'])
    await expect(note.locator('strong code')).toHaveText(['variant'])
    await expect(note.locator('strong a')).toHaveText(['here'])

    // One click opens one tab and selects the note; the registry is unchanged.
    await page.waitForTimeout(600)
    const opened: string[] = []
    page.context().on('page', (tab) => opened.push(tab.url()))
    const popup = page.waitForEvent('popup')
    await links.first().click()
    const tab = await popup
    await tab.waitForURL('https://example.com/spec')
    await tab.close()
    await expect(note).toHaveAttribute('data-selected', 'true')
    expect(opened).toHaveLength(1)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(noted)

    // A drag that starts on a link moves the note and opens nothing.
    await page.bringToFront()
    const start = (await links.first().boundingBox())!
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(start.x + start.width / 2 + 60, start.y + start.height / 2 + 40, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => readFileSync(REGISTRY, 'utf8').match(/id: "links"[^}]*?\bx: (-?\d+)/)?.[1], { timeout: 15_000 }).not.toBe('0')
    await page.waitForTimeout(300)
    expect(opened).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a pasted image is kept in the canvas folder, moves and resizes in proportion, and Delete and Undo work on it', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const folder = 'design-canvas/smoke/images'
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    // A picture twice as wide as it is tall, pasted as a copied screenshot is. It lands at the
    // pointer, here on empty canvas clear of the item and the bars.
    await page.mouse.move(230, 560)
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 200
      const context = canvas.getContext('2d')!
      context.fillStyle = '#2f6fed'
      context.fillRect(0, 0, 400, 200)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
      const data = new DataTransfer()
      data.items.add(new File([blob], 'reference.png', { type: 'image/png' }))
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    // Stored again as WebP, or as it came when that is not smaller.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toMatch(/file: "image-1\.(webp|png)"/)
    const stored = () => readdirSync(folder).filter((name) => name.startsWith('image-1.'))
    expect(stored()).toHaveLength(1)
    const entry = () => /\{ id: "image-1"[^}]*\}/.exec(readFileSync(REGISTRY, 'utf8'))?.[0] ?? ''
    const placed = entry()
    expect(placed).toContain('width: 400, height: 200')
    const image = page.locator('.canvas-image[data-canvas-image="image-1"]')
    await expect.poll(() => image.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(400)
    await expect(page.locator('.canvas-image[data-placing]')).toHaveCount(0)
    // A drag moves it and selects it, and the move is saved.
    const box = (await image.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 6 })
    await page.mouse.up()
    await expect.poll(entry).not.toBe(placed)
    expect(entry()).toContain('width: 400, height: 200')
    await expect(image).toHaveAttribute('data-selected', 'true')
    await expect(image.locator('.canvas-resize')).toHaveCount(4)
    // A corner resizes it, and the picture keeps its proportions.
    const moved = entry()
    const grip = (await image.locator('.canvas-resize[data-corner="se"]').boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2 + 5, { steps: 6 })
    await page.mouse.up()
    await expect.poll(entry).not.toBe(moved)
    const size = /width: (\d+), height: (\d+)/.exec(entry())!
    expect(Number(size[1])).toBeGreaterThan(400)
    expect(Math.abs(Number(size[1]) / Number(size[2]) - 2)).toBeLessThan(0.02)
    // Delete takes it off the canvas and keeps its file, so Undo can bring it back.
    const resized = entry()
    await page.keyboard.press('Delete')
    await expect.poll(entry).toBe('')
    await expect(image).toHaveCount(0)
    expect(stored()).toHaveLength(1)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(entry).toBe(resized)
    await expect(image).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
    rmSync(folder, { recursive: true, force: true })
  }
})

async function withSection(page: Page, original: string) {
  const sectioned = original.replace(
    'export const sections: CanvasSection[] = [];',
    'export const sections: CanvasSection[] = [\n  { id: "group", title: "Group", x: -40, y: -60, width: 640, height: 420 },\n];',
  )
  expect(sectioned).not.toBe(original)
  writeFileSync(REGISTRY, sectioned)
  // Loaded only once the dev server serves the new registry. On a slow machine the
  // page could otherwise load the old one before the server sees the file change,
  // and miss the hot update that follows.
  await expect
    .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "group"'), { timeout: 15_000 })
    .toBe(true)
  await page.goto('/')
  await expect(page.locator('.canvas-section[data-board-id="group"]')).toBeVisible()
  await page.waitForTimeout(600)
  return sectioned
}

test('a section resizes from its border like an item, and a click inside selects it', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const sectioned = await withSection(page, original)
    const section = page.locator('.canvas-section[data-board-id="group"]')
    const frame = section.locator('.canvas-section-frame')
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    const box = (await frame.boundingBox())!
    const itemBefore = (await item.boundingBox())!
    // No selection needed: the right edge resizes the frame alone, as an item's border does.
    await page.mouse.move(box.x + box.width, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width + 80, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
    const resized = (await frame.boundingBox())!
    expect(Math.abs(resized.x - box.x)).toBeLessThan(1)
    expect(resized.width).toBeGreaterThan(box.width + 60)
    expect((await item.boundingBox())!.x).toBe(itemBefore.x)
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toContain('width: 640')
    expect(readFileSync(REGISTRY, 'utf8')).toContain('x: -40, y: -60')
    // The resize selected it, and it stays selected once saved; ⌘/Ctrl + Z puts it back.
    await expect(page.locator('.canvas-section[data-board-id="group"][data-selected]')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(sectioned)
    // A click outside lets go; a click on empty space inside selects it and shows its grips.
    await page.mouse.click(box.x + box.width + 160, box.y + box.height / 2)
    await expect(section).not.toHaveAttribute('data-selected')
    await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30)
    await expect(section).toHaveAttribute('data-selected', 'true')
    await expect(section.locator('.canvas-resize')).toHaveCount(4)
    // A drag inside draws a selection box: nothing pans, and what the box touches is selected
    // in the section's place. The section itself is selected only by a box around all of it.
    await page.mouse.move(box.x + box.width - 30, box.y + box.height - 30)
    await page.mouse.down()
    await page.mouse.move(itemBefore.x + itemBefore.width - 20, itemBefore.y + itemBefore.height - 20, { steps: 6 })
    await expect(page.locator('.canvas-draw')).toBeVisible()
    await page.mouse.up()
    expect(Math.abs((await frame.boundingBox())!.x - box.x)).toBeLessThan(1)
    await expect(item).toHaveAttribute('data-selected', 'true')
    await expect(section).not.toHaveAttribute('data-selected')
    // Space + drag still pans, and keeps the selection.
    await page.keyboard.down('Space')
    await page.mouse.move(box.x + box.width - 30, box.y + box.height - 30)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width + 30, box.y + box.height - 30, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    expect(Math.abs((await frame.boundingBox())!.x - box.x - 60)).toBeLessThan(3)
    await expect(item).toHaveAttribute('data-selected', 'true')
    expect(readFileSync(REGISTRY, 'utf8')).toBe(sectioned)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('after typing in a preview, one Undo puts back a section dragged with its items', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const sectioned = await withSection(page, original)
    // Keyboard focus in a preview's field, as after typing in it.
    await page.locator('.canvas-preview').first().evaluate((preview) => {
      const field = document.createElement('input')
      preview.append(field)
      field.focus()
    })
    const tab = (await page.locator('.canvas-section[data-board-id="group"] .canvas-section-tab').boundingBox())!
    await page.mouse.move(tab.x + 30, tab.y + tab.height / 2)
    await page.mouse.down()
    await page.mouse.move(tab.x + 80, tab.y + 40, { steps: 3 })
    // A pause mid-drag saves nothing; the frame keeps following the pointer.
    await page.waitForTimeout(700)
    expect(readFileSync(REGISTRY, 'utf8')).toBe(sectioned)
    await page.mouse.move(tab.x + 130, tab.y + 80, { steps: 3 })
    await page.mouse.up()
    // At once, before the save lands: the drag goes first, and this undoes it.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.locator('.canvas-toast')).toContainText('Undone')
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toBe(sectioned)
    await expect(page.locator('.canvas-section[data-board-id="group"]')).toBeVisible()
    await expect(page.locator('[data-board-ghost]')).toHaveCount(0)
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('holding Z zooms as in Figma, and Shift + 0 and 1 set the view', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(600)
  const zoom = page.locator('.canvas-zoom')
  const viewport = page.locator('.canvas-viewport')
  await page.getByRole('button', { name: 'Reset view (actual size)' }).click()
  await expect(zoom).toHaveText('100%')
  await page.mouse.move(400, 300)
  await viewport.focus()
  await page.keyboard.down('z')
  await expect(viewport).toHaveAttribute('data-zoom', 'in')
  // Over a preview too: the click zooms and reaches nothing under it.
  const preview = (await page.locator('.canvas-preview').first().boundingBox())!
  await page.mouse.click(preview.x + 40, preview.y + 40)
  await expect(zoom).toHaveText('200%')
  await page.keyboard.down('Alt')
  await page.mouse.move(400, 300)
  await expect(viewport).toHaveAttribute('data-zoom', 'out')
  await page.mouse.click(400, 300)
  await expect(zoom).toHaveText('100%')
  await page.keyboard.up('Alt')
  // A drag zooms to fit the area it draws.
  await page.mouse.move(300, 250)
  await page.mouse.down()
  await page.mouse.move(500, 350, { steps: 6 })
  await page.mouse.up()
  await expect(zoom).not.toHaveText('100%')
  await page.keyboard.up('z')
  await expect(viewport).not.toHaveAttribute('data-zoom')
  await expect(page.locator('.canvas-toast')).toHaveCount(0)
  // Fit all stops at 100% for this one small item; Shift + 0 is 100% from any level.
  await page.keyboard.press('Shift+Digit1')
  await expect(zoom).toHaveText('100%')
  await page.keyboard.press('=')
  await expect(zoom).toHaveText('200%')
  await page.keyboard.press('Shift+Digit0')
  await expect(zoom).toHaveText('100%')
  expect(errors).toEqual([])
})

test('Interact is the default tool and Escape returns to it', async ({ page }) => {
  await page.goto('/')
  const tool = (name: string) => page.getByRole('button', { name, exact: true })
  await expect(tool('Interact')).toHaveAttribute('aria-pressed', 'true')
  // A hovered button's tooltip joins its accessible name, so the mouse leaves between steps.
  await tool('Note').click()
  await page.mouse.move(400, 300)
  await expect(tool('Note')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Interact')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect(tool('Interact')).toHaveAttribute('aria-pressed', 'true')
  await tool('Ask agent').click()
  await page.mouse.move(400, 300)
  await expect(tool('Ask agent')).toHaveAttribute('aria-pressed', 'true')
  await tool('Interact').click()
  await page.mouse.move(400, 300)
  await expect(tool('Interact')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Ask agent')).toHaveAttribute('aria-pressed', 'false')
})

test('the Hand tool moves the canvas with a drag, with no key held, and Escape ends it', async ({ page }) => {
  await page.goto('/')
  const tool = (name: string) => page.getByRole('button', { name, exact: true })
  const world = page.locator('.canvas-world')
  const transform = () => world.evaluate((element) => getComputedStyle(element).transform)
  await tool('Move canvas').click()
  await page.mouse.move(400, 300)
  await expect(tool('Move canvas')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Interact')).toHaveAttribute('aria-pressed', 'false')
  // A drag that starts on an item moves the canvas, not the item.
  const item = await page.locator('.canvas-item[data-canvas-item="example"] .canvas-preview').boundingBox()
  const before = await transform()
  await page.mouse.move(item!.x + 40, item!.y + 40)
  await page.mouse.down()
  await page.mouse.move(item!.x + 140, item!.y + 90, { steps: 6 })
  await page.mouse.up()
  expect(await transform()).not.toBe(before)
  await expect(tool('Move canvas')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(tool('Interact')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('h')
  await expect(tool('Move canvas')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('v')
  await expect(tool('Interact')).toHaveAttribute('aria-pressed', 'true')
})

// Before the agent tests: they leave the agent busy for a while, and then the button sends instead of copying.
test('a drag annotates an area, and the name annotates the whole item', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  // The first paint fits the canvas to the window once fonts load; measure after that moved the camera.
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  const preview = page.locator('.canvas-preview[data-canvas-preview="example"]')
  const box = (await preview.boundingBox())!
  // Item pixels to screen pixels, whatever the zoom: drag across the heading only.
  const scale = box.width / 360
  await page.mouse.move(box.x + 4 * scale, box.y + 4 * scale)
  await page.mouse.down()
  await page.mouse.move(box.x + 180 * scale, box.y + 30 * scale, { steps: 4 })
  await page.mouse.move(box.x + 356 * scale, box.y + 50 * scale, { steps: 4 })
  await page.mouse.up()
  const area = page.getByRole('dialog', { name: /^Ask agent about Example · replace me › area / })
  // The card shows no title; its name says what the area holds, and that goes to the agent.
  await expect(area).toHaveAccessibleName(/heading “Canvas is ready”/)
  await expect(area).not.toHaveAccessibleName(/text “Add items/)
  await expect(area).not.toContainText('Canvas is ready')
  await area.getByRole('textbox').fill('Tighter header')
  await area.getByRole('textbox').press('Enter')
  await expect(page.locator('.canvas-area')).toHaveCount(1)
  // In annotate mode the item's name stands for the whole item, instead of copying it.
  await page.locator('.canvas-item[data-canvas-item="example"] .canvas-name').click()
  const whole = page.getByRole('dialog', { name: 'Ask agent about Example · replace me' })
  await whole.getByRole('textbox').fill('Denser overall')
  await whole.getByRole('textbox').press('Enter')
  await expect(page.locator('.canvas-area')).toHaveCount(2)
  await page.getByRole('button', { name: 'Copy 2 for agent' }).click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/1\. Example · replace me › area \d+×\d+ at \d+,\d+: heading “Canvas is ready”\n {3}Tighter header/)
  expect(text).toContain('2. Example · replace me\n   Denser overall')
  expect(errors).toEqual([])
})

test('a double-click on a text rewrites it in place, and the edit becomes a change', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  const heading = page.locator('.canvas-preview[data-canvas-preview="example"] h2')
  await heading.dblclick()
  // The words are edited where they sit, selected, with no note open yet.
  await expect(heading).toHaveAttribute('data-canvas-editing', '')
  await expect(page.getByRole('dialog', { name: /^Ask agent about/ })).toHaveCount(0)
  await page.keyboard.type('Canvas is live')
  await expect(heading).toHaveText('Canvas is live')
  await page.keyboard.press('Enter')
  // The new words stay where they sit, marked as not applied yet, and the edit is a note for the agent.
  await expect(heading).toHaveText('Canvas is live')
  await expect(heading).toHaveAttribute('data-canvas-pending', /.+/)
  await expect(heading).not.toHaveAttribute('contenteditable')
  const note = page.getByRole('dialog', { name: 'Ask agent about Example · replace me › heading “Canvas is ready”' })
  await expect(note.getByRole('textbox')).toHaveValue('Change the text from “Canvas is ready” to “Canvas is live”')
  await page.keyboard.press('Enter')
  await expect(note).toHaveCount(0)
  // Escape cancels an edit, and stays in annotate mode.
  const text = page.locator('.canvas-preview[data-canvas-preview="example"] p')
  await text.dblclick()
  await page.keyboard.type('Gone')
  await page.keyboard.press('Escape')
  await expect(text).toHaveText("Add items in registry.tsx that render the app's own components.")
  await expect(page.getByRole('dialog', { name: /^Ask agent about/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ask agent', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('1. Example · replace me › heading “Canvas is ready”\n   Change the text from “Canvas is ready” to “Canvas is live”')
  expect(errors).toEqual([])
})

test('new words stay on show until their note goes, and give way to the agent\'s change', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const original = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    const heading = page.locator('.canvas-preview[data-canvas-preview="example"] h2')
    const text = page.locator('.canvas-preview[data-canvas-preview="example"] p')
    // Two texts rewritten one after the other both stay, so they can be judged together.
    await heading.dblclick()
    await page.keyboard.type('Canvas is live')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await text.dblclick()
    await page.keyboard.type('Pick the screens you like.')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(heading).toHaveText('Canvas is live')
    await expect(text).toHaveText('Pick the screens you like.')
    // Editing new words again starts from them and changes the same note. Off centre: the pin sits there.
    await heading.dblclick({ position: { x: 4, y: 6 } })
    await expect(heading).toHaveAttribute('data-canvas-editing', '')
    await expect(heading).toHaveText('Canvas is live')
    await page.keyboard.type('Canvas is great')
    await page.keyboard.press('Enter')
    const note = page.getByRole('dialog', { name: /^Ask agent about Example · replace me › heading/ })
    await expect(note.getByRole('textbox')).toHaveValue('Change the text from “Canvas is ready” to “Canvas is great”')
    await expect(page.locator('.canvas-pin-bubble')).toHaveCount(2)
    // In place this time, so the agent's change shows on this item.
    await note.getByRole('checkbox').uncheck()
    await note.getByRole('textbox').press('Enter')
    // Deleting a note puts its text's own words back.
    await page.getByRole('button', { name: /^For the agent, 2:/ }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(text).toHaveText("Add items in registry.tsx that render the app's own components.")
    await expect(text).not.toHaveAttribute('data-canvas-pending')
    // Sent, then the agent changes the words in source: the item renders them itself, and the note clears.
    await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
    await expect(page.getByRole('button', { name: /^Sent to the agent/ })).toHaveCount(1)
    writeFileSync(EXAMPLE, original.replace('Canvas is ready', 'Canvas is great'))
    await expect(page.getByRole('button', { name: /^Sent to the agent/ })).toHaveCount(0, { timeout: 15_000 })
    await expect(heading).toHaveText('Canvas is great')
    await expect(heading).not.toHaveAttribute('data-canvas-pending')
    // The item the agent changed says so until the person has seen it.
    await expect(page.locator('.canvas-item[data-canvas-item="example"] .canvas-ghost-tag[data-state="fresh"]')).toHaveText('Updated')
    expect(errors).toEqual([])
  } finally {
    if (readFileSync(EXAMPLE, 'utf8') !== original) {
      const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
      writeFileSync(EXAMPLE, original)
      await updated
    }
  }
})

test('the note field grows with its text, then scrolls', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toBeVisible()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  // A rewritten text makes a long note, and it opens showing all of it.
  await page.locator('.canvas-preview[data-canvas-preview="example"] p').dblclick()
  await page.keyboard.type('Add the items you want to compare in registry.tsx. Each one renders the components your app already has.')
  await page.keyboard.press('Enter')
  const field = page.getByRole('dialog', { name: /^Ask agent about/ }).getByRole('textbox')
  const size = () =>
    field.evaluate((element) => ({ height: element.offsetHeight, hidden: element.scrollHeight - element.clientHeight }))
  await expect.poll(size).toMatchObject({ hidden: 0 })
  expect((await size()).height).toBeGreaterThan(90)
  // Past about ten lines it stops growing and scrolls.
  await field.fill(Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join('\n'))
  await expect.poll(async () => (await size()).hidden).toBeGreaterThan(0)
  expect((await size()).height).toBeLessThan(240)
  // Short again, it goes back to three lines.
  await field.fill('Short')
  await expect.poll(async () => (await size()).height).toBeLessThan(80)
  expect(errors).toEqual([])
})

test('a new version lands beside its original where it is now, not where the agent last read it', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    await page.goto('/')
    const example = page.locator('.canvas-item[data-canvas-item="example"]')
    await expect(example).toBeVisible()
    await page.waitForTimeout(600)
    // The person moves the original while the agent works.
    const grip = (await example.getByRole('button', { name: 'Move Example · replace me', exact: true }).boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + 200, grip.y + 260, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toMatch(/x: 0,\s*y: 0,/)
    const at = (id: string) => {
      const entry = readFileSync(REGISTRY, 'utf8').split('id: "' + id + '"')[1] ?? ''
      return { x: Number(entry.match(/x: (-?\d+)/)?.[1]), y: Number(entry.match(/y: (-?\d+)/)?.[1]) }
    }
    const moved = at('example')
    const view = (await example.boundingBox())!
    // The agent adds the new version where it read the original: its old place.
    writeFileSync(
      REGISTRY,
      readFileSync(REGISTRY, 'utf8').replace(
        /\];\s*$/,
        '  { id: "next", name: "Next", component: Example, from: "example", x: 0, y: 0, width: 360, height: 180 },\n];\n',
      ),
    )
    const next = page.locator('.canvas-item[data-canvas-item="next"]')
    await expect(next).toBeVisible({ timeout: 15_000 })
    // It goes right of the original as it is now, and that place is saved.
    await expect.poll(() => at('next')).toEqual({ x: moved.x + 360 + 96, y: moved.y })
    expect(at('example')).toEqual(moved)
    // The view stays where the person is, and the new item says it is new.
    expect((await example.boundingBox())!).toEqual(view)
    const tag = next.locator('.canvas-ghost-tag[data-state="fresh"]')
    await expect(tag).toHaveText('New')
    // Once it has been on screen for a moment, it is no longer new.
    await page.getByRole('button', { name: 'Fit all' }).click()
    await expect(tag).toHaveCount(0, { timeout: 6_000 })
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('dragging an item or a note outlines the section it will land in', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const noted = original.replace(
      'export const notes: CanvasNote[] = [];',
      'export const notes: CanvasNote[] = [\n  { id: "loose", text: "Loose note", x: 900, y: 0 },\n];',
    )
    await withSection(page, noted)
    const section = page.locator('.canvas-section[data-board-id="group"]')
    const frame = (await section.locator('.canvas-section-frame').boundingBox())!
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    const start = (await item.boundingBox())!
    const grip = (await item.getByRole('button', { name: 'Move Example · replace me', exact: true }).boundingBox())!
    const gx = grip.x + grip.width / 2
    const gy = grip.y + grip.height / 2
    const centre = start.x + start.width / 2
    await page.mouse.move(gx, gy)
    await page.mouse.down()
    // Outlined while the item's centre is inside, the rule a section's moves and notes go by.
    await page.mouse.move(gx + (frame.x + frame.width * 0.85 - centre), gy, { steps: 6 })
    await expect(section).toHaveAttribute('data-drop', '')
    // An edge still over the section is not enough.
    await page.mouse.move(gx + (frame.x + frame.width + 30 - centre), gy, { steps: 6 })
    expect((await item.boundingBox())!.x).toBeLessThan(frame.x + frame.width)
    await expect(section).not.toHaveAttribute('data-drop')
    await page.mouse.move(gx, gy, { steps: 6 })
    await expect(section).toHaveAttribute('data-drop', '')
    await page.mouse.up()
    await expect(section).not.toHaveAttribute('data-drop')
    // A note dragged in is outlined the same way.
    const note = page.locator('.canvas-note-card[data-board-id="loose"]')
    const n = (await note.boundingBox())!
    await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2)
    await page.mouse.down()
    await page.mouse.move(frame.x + frame.width / 2, n.y + n.height / 2, { steps: 8 })
    await expect(page.locator('.canvas-section[data-drop]')).toHaveCount(1)
    await page.mouse.up()
    await expect(page.locator('.canvas-section[data-drop]')).toHaveCount(0)
    // The move saves into registry.tsx; it must land before the registry is put back.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).not.toContain('x: 900')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a dragged item snaps to another preview\'s edge and shows a guide', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const two = original.replace(
      /\];\s*$/,
      '  { id: "other", name: "Other", component: Example, x: 500, y: 400, width: 360, height: 180 },\n];\n',
    )
    writeFileSync(REGISTRY, two)
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "other"'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const other = page.locator('.canvas-item[data-canvas-item="other"]')
    await expect(other).toBeVisible()
    await page.waitForTimeout(600)
    const preview = (id: string) => page.locator(`[data-canvas-preview="${id}"]`).boundingBox().then((box) => box!)
    const target = await preview('example')
    const from = await preview('other')
    const name = (await other.locator('.canvas-name').boundingBox())!
    const px = name.x + name.width / 2
    const py = name.y + name.height / 2
    const guide = page.locator('.canvas-guide[data-guide="vertical"]')
    await page.mouse.move(px, py)
    await page.mouse.down()
    // Dropped 4 px short of the other preview's left edge, it catches on it.
    await page.mouse.move(px + (target.x - from.x) + 4, py, { steps: 8 })
    expect(Math.abs((await preview('other')).x - target.x)).toBeLessThan(0.75)
    await expect(guide).toBeVisible()
    // Well clear of any edge or centre, it follows the pointer and the guide goes.
    await page.mouse.move(px + (target.x - from.x) + 60, py, { steps: 8 })
    expect((await preview('other')).x - target.x).toBeGreaterThan(40)
    await expect(guide).toBeHidden()
    await page.mouse.move(px + (target.x - from.x) - 3, py, { steps: 8 })
    await expect(guide).toBeVisible()
    await page.mouse.up()
    await expect(guide).toBeHidden()
    // The aligned position is what is saved.
    await expect.poll(() => readFileSync(REGISTRY, 'utf8')).toMatch(/id: "other"[^}]*x: 0,/)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a click on a section title in annotate mode is a note on the whole section', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    // A second item a little higher on the same row, and a note, both inside the section.
    const filled = original
      .replace(
        'export const notes: CanvasNote[] = [];',
        'export const notes: CanvasNote[] = [\n  { id: "pick", text: "Keep this\\nheader", x: 0, y: 250 },\n];',
      )
      .replace(/\];\s*$/, '  { id: "second", name: "Second", component: Example, x: 400, y: -20, width: 160, height: 180 },\n];\n')
    expect(filled).toContain('id: "second"')
    const sectioned = await withSection(page, filled)
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    const section = page.locator('.canvas-section[data-board-id="group"]')
    await section.locator('.canvas-section-tab').click()
    const note = page.getByRole('dialog', { name: 'Ask agent about Section “Group”' })
    await expect(note).toBeVisible()
    // No new-version choice: a section has no one original to keep. Nor is the section selected.
    await expect(note.getByRole('checkbox')).toHaveCount(0)
    await expect(section).not.toHaveAttribute('data-selected')
    await page.keyboard.type('Make one flow from these')
    await page.keyboard.press('Enter')
    await expect(note).toHaveCount(0)
    await page.getByRole('button', { name: 'Copy 1 for agent' }).click()
    // What is inside is read when it is sent: items in reading order (rows, then left to right), then notes.
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain(
      '1. Section “Group”, with these items in reading order: Example · replace me (id example), Second (id second); notes in it: “Keep this header”\n   Make one flow from these',
    )
    const pin = page.locator('.canvas-section-pins .canvas-pin-bubble')
    await expect(pin).toHaveAttribute('aria-label', 'Sent to the agent: Make one flow from these')
    // The agent's usual answer, a new item, clears it.
    writeFileSync(REGISTRY, sectioned.replace(/\];\s*$/, '  { id: "flow", name: "Flow", component: Example, x: 0, y: 600, width: 360, height: 180 },\n];\n'))
    await expect(pin).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('.canvas-toast')).toContainText('Cleared 1 sent pin on updated items')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a text in a viewport item is rewritten in place too, and a press outside keeps it', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const phoned = original.replace(
      /\];\s*$/,
      '  { id: "phone", name: "Phone", component: Example, x: 0, y: 240, width: 375, height: 180, viewport: true },\n];\n',
    )
    expect(phoned).not.toBe(original)
    writeFileSync(REGISTRY, phoned)
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "phone"'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const heading = page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('h2')
    await expect(heading).toHaveText('Canvas is ready')
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    await heading.dblclick()
    await expect(heading).toHaveAttribute('data-canvas-editing', '')
    // The first click's empty note gives way to the edit, and the keys reach the frame.
    await expect(page.getByRole('dialog', { name: /^Ask agent about/ })).toHaveCount(0)
    await page.keyboard.type('Phone is ready')
    await expect(heading).toHaveText('Phone is ready')
    // A press on empty canvas, outside the frame, ends the edit and keeps it.
    const box = (await page.locator('.canvas-viewport').boundingBox())!
    await page.mouse.click(box.x + box.width - 80, box.y + box.height / 2)
    await expect(heading).toHaveText('Phone is ready')
    await expect(heading).toHaveAttribute('data-canvas-pending', /.+/)
    const note = page.getByRole('dialog', { name: 'Ask agent about Phone › heading “Canvas is ready”' })
    await expect(note.getByRole('textbox')).toHaveValue('Change the text from “Canvas is ready” to “Phone is ready”')
    // Deleting the note puts the frame's words back.
    await note.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(heading).toHaveText('Canvas is ready')
    await expect(heading).not.toHaveAttribute('data-canvas-pending')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('zoomed out, the name row and its actions take a press, and the top edge still resizes', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, withVersions(original))
    await servesId(page, 'c')
    await page.goto('/')
    const item = (id: string) => page.locator(`.canvas-item[data-canvas-item="${id}"]`)
    await expect(item('c')).toBeVisible()
    await page.waitForTimeout(400)
    // The resize zones keep one size on screen, so at 25% the top one used to reach up over the name row.
    await page.mouse.move(400, 300)
    await page.locator('.canvas-viewport').focus()
    await page.keyboard.press('0')
    await page.keyboard.press('-')
    await page.keyboard.press('-')
    await expect(page.locator('.canvas-zoom')).toHaveText('25%')
    const preview = (await page.locator('[data-canvas-preview="b"]').boundingBox())!
    await page.mouse.move(preview.x + preview.width / 2, preview.y + preview.height / 2)
    const pick = page.getByRole('button', { name: 'Pick Version B and set the others aside' })
    await expect(pick).toHaveCSS('opacity', '1')
    const under = (x: number, y: number) =>
      page.evaluate(([px, py]) => {
        const hit = document.elementFromPoint(px!, py!)
        const edge = hit?.closest('.canvas-item-edge')
        if (edge) return `edge ${edge.getAttribute('data-edge')}`
        return hit?.closest('.canvas-item-title') ? 'title' : 'other'
      }, [x, y])
    // The lowest pixels of Pick and of the name are the name row's, not a resize zone's.
    const button = (await pick.boundingBox())!
    expect(await under(button.x + button.width / 2, button.y + button.height - 1)).toBe('title')
    const name = (await item('b').locator('.canvas-name').boundingBox())!
    expect(await under(name.x + 4, name.y + name.height - 1)).toBe('title')
    // Just inside the preview's top, the top edge still takes the press.
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.getAttribute('data-edge') ?? null, [preview.x + preview.width / 2, preview.y + 2])).toBe('n')
    await pick.click()
    await expect.poll(() => entryOf('b')).toContain('picked: true')
    expect(entryOf('b')).toContain('width: 360, height: 180')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test("an item's actions sit at its top right: Ask with quick requests, Pick, and More", async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(REGISTRY, withVersions(original))
    await servesId(page, 'c')
    await page.goto('/')
    const item = page.locator('.canvas-item[data-canvas-item="b"]')
    await expect(item).toBeVisible()
    await page.waitForTimeout(600)
    const ask = page.getByRole('button', { name: 'Ask agent about Version B' })
    const pick = page.getByRole('button', { name: 'Pick Version B and set the others aside' })
    const more = page.getByRole('button', { name: 'More actions for Version B' })
    // Quiet until the item is hovered, on its name or on its preview.
    const actions = item.locator('.canvas-item-actions')
    await page.mouse.move(5, 5)
    await expect(actions).toHaveCSS('opacity', '0')
    const resting = (await item.locator('.canvas-preview').boundingBox())!
    await item.locator('.canvas-preview').hover()
    await expect(actions).toHaveCSS('opacity', '1')
    // Showing them moves nothing down: the preview stays where it was, under the pointer.
    expect(Math.abs((await item.locator('.canvas-preview').boundingBox())!.y - resting.y)).toBeLessThan(0.5)
    // At the frame's right edge, in this order; Pick is an icon like the others.
    const preview = (await item.locator('.canvas-preview').boundingBox())!
    const boxes = [(await ask.boundingBox())!, (await pick.boundingBox())!, (await more.boundingBox())!]
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x)
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x)
    // They are one toolbar, whose outer edge meets the frame's right edge.
    const bar = (await actions.boundingBox())!
    expect(Math.abs(bar.x + bar.width - (preview.x + preview.width))).toBeLessThan(3)
    expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(bar.x + bar.width)
    expect(bar.y + bar.height).toBeLessThanOrEqual(preview.y)
    await expect(pick).toHaveText('')
    await expect(pick).toHaveAttribute('data-tip', 'Pick')
    // The name is a title: a click on it copies nothing and shows nothing.
    await page.evaluate(() => navigator.clipboard.writeText('untouched'))
    await item.locator('.canvas-name').click()
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('untouched')
    await expect(page.locator('.canvas-toast')).toHaveCount(0)
    // Ask opens a note about the whole item, with no tool chosen first, and offers quick requests.
    await ask.click()
    const note = page.getByRole('dialog', { name: 'Ask agent about Version B' })
    await expect(note).toBeVisible()
    const quick = note.getByRole('group', { name: 'Quick requests' })
    await expect(quick.getByRole('button')).toHaveText(['Flow', 'Phone', 'States', 'Languages'])
    await quick.getByRole('button', { name: 'States' }).click()
    await expect(note.getByRole('textbox')).toHaveValue('Add its empty, loading, and error states.')
    await expect(note.getByRole('textbox')).toBeFocused()
    // With words in the note the quick requests are gone; the words can be changed like any others.
    await expect(quick).toHaveCount(0)
    await note.getByRole('textbox').press('Enter')
    await expect(note).toHaveCount(0)
    await expect(item.locator('.canvas-pin')).toHaveCount(1)
    // A second press opens the note that waits; it does not add another.
    await item.locator('.canvas-preview').hover()
    await ask.click()
    await expect(note.getByRole('textbox')).toHaveValue('Add its empty, loading, and error states.')
    await page.keyboard.press('Escape')
    await expect(item.locator('.canvas-pin')).toHaveCount(1)
    // More holds what is used seldom. It opens on a press and closes on Escape or a press outside.
    const open = page.getByRole('link', { name: 'Open Version B in a new tab' })
    const trash = page.getByRole('button', { name: 'Move Version B to the trash' })
    await expect(trash).toHaveCount(0)
    await item.locator('.canvas-preview').hover()
    await more.click()
    await expect(open).toBeVisible()
    await expect(trash).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trash).toHaveCount(0)
    await more.click()
    await page.mouse.click(5, 5)
    await expect(trash).toHaveCount(0)
    // A press on an action never starts a move.
    const before = (await item.boundingBox())!
    await more.click()
    await trash.click()
    await expect(page.locator('.canvas-toast')).toContainText('Moved Version B to the trash')
    await page.locator('.canvas-toast').getByRole('button', { name: 'Undo' }).click()
    await expect(item).toBeVisible()
    expect(Math.abs((await item.boundingBox())!.x - before.x)).toBeLessThan(1)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a link or a router call stays in its item, and only a new-tab link goes to another item', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    // Screens that point at each other as a product's do: links by path, and a router's push and back.
    writeFileSync(
      EXAMPLE,
      `import { type ReactNode, useContext } from "react";
import { BACK_EVENT, NAVIGATE_EVENT } from "../canvas/bridge";
import { RouteContext } from "../canvas/routes";
const push = (href: string) => window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: href }));
function Screen({ title, children }: { title: string; children?: ReactNode }) {
  const path = useContext(RouteContext);
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
      <p data-path>{path}</p>
      {children}
    </div>
  );
}
export const Example = () => (
  <Screen title="Plans">
    <a href="/checkout?plan=team">Choose</a> <a href="/orders/42">Order</a> <a href="/help">Help here</a>{" "}
    <a href="/help" target="_blank">Help tab</a> <a href="/checkout" target="_blank">Checkout tab</a> <a href="/nowhere">Lost</a>{" "}
    <a href="/nowhere" target="_blank">Lost tab</a>
  </Screen>
);
export const Checkout = () => (
  <Screen title="Checkout">
    <button type="button" onClick={() => push("/done")}>Pay</button>{" "}
    <button type="button" onClick={() => window.dispatchEvent(new Event(BACK_EVENT))}>Back</button>
  </Screen>
);
export const Done = () => (
  <Screen title="Done">
    <a href="/plans">Start over</a>
  </Screen>
);
export const Order = () => <Screen title="Order" />;
export const Help = () => (
  <Screen title="Help">
    <a href="/checkout">To checkout</a> <a href="/checkout" target="_blank">Checkout tab</a>
  </Screen>
);
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Checkout, Done, Example, Help, Order } from "./items/Example";')
        .replace('component: Example,', 'component: Example,\n    path: "/plans",\n    screens: { "/checkout": Checkout, "/done": Done, "/orders/[id]": Order },')
        .replace(
          /\];\s*$/,
          `  { id: "help", name: "Help page", component: Help, path: "/help", x: 1500, y: 0, width: 300, height: 160 },
  { id: "phone", name: "Phone", component: Example, path: "/plans", screens: { "/checkout": Checkout, "/done": Done }, x: 0, y: 260, width: 375, height: 200, viewport: true },
];
`,
        ),
    )
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "phone"'), { timeout: 15_000 })
      .toBe(true)
    await expect
      .poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('Checkout'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const plain = page.locator('.canvas-item[data-canvas-item="example"] .canvas-preview')
    const frame = page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('body')
    const help = page.locator('.canvas-item[data-canvas-item="help"]')
    await expect(frame.getByRole('heading')).toHaveText('Plans')
    await page.waitForTimeout(600)
    const address = page.url()
    for (const [name, item] of [
      ['a plain item', plain],
      ['a frame', frame],
    ] as const) {
      const other = item === plain ? frame : plain
      // The item knows its own path.
      await expect(item.locator('[data-path]'), name).toHaveText('/plans')
      // A link to one of its screens shows that screen in place: no notice, the page stays, no other item changes.
      await item.getByRole('link', { name: 'Choose' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Checkout')
      await expect(item.locator('[data-path]'), name).toHaveText('/checkout')
      await expect(other.getByRole('heading'), name).toHaveText('Plans')
      await expect(page.locator('.canvas-toast')).toHaveCount(0)
      expect(page.url()).toBe(address)
      // A router call goes the same way, and its back() returns.
      await item.getByRole('button', { name: 'Pay' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Done')
      await item.getByRole('link', { name: 'Start over' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
      await item.getByRole('link', { name: 'Choose' }).click()
      await item.getByRole('button', { name: 'Back' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
      // Restart returns to the first screen.
      await item.getByRole('link', { name: 'Choose' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Checkout')
      const id = item === plain ? 'example' : 'phone'
      await page.locator(`.canvas-item[data-canvas-item="${id}"] .canvas-name`).hover()
      await page.getByRole('button', { name: item === plain ? 'Restart Example · replace me' : 'Restart Phone' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
      await expect(item.locator('[data-path]'), name).toHaveText('/plans')
    }
    // A path with a part that changes, "/orders/[id]".
    await plain.getByRole('link', { name: 'Order' }).click()
    await expect(plain.getByRole('heading')).toHaveText('Order')
    await page.locator('.canvas-item[data-canvas-item="example"] .canvas-name').hover()
    await page.getByRole('button', { name: 'Restart Example · replace me' }).click()
    // A path the item does not have stays where it is, with a notice, also when another item shows
    // that path: a click in the product stays in its tab, so a click here never moves the view.
    await page.getByRole('button', { name: 'Reset view (actual size)' }).click()
    const inView = async () => {
      const box = await help.boundingBox()
      return !!box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width
    }
    // The view is put on the page a frame later, so its place is asked until it is there.
    await expect.poll(inView).toBe(false)
    await plain.getByRole('link', { name: 'Help here' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('This item has no screen for /help')
    await page.waitForTimeout(400)
    expect(await inView()).toBe(false)
    await expect(plain.getByRole('heading')).toHaveText('Plans')
    // A link that opens a new tab in the product goes to the item that shows the path, and the item it was in stays as it is.
    await plain.getByRole('link', { name: 'Help tab' }).click()
    await expect.poll(inView).toBe(true)
    // The view glides there and puts that item in the middle.
    const middle = async (locator: typeof help) => {
      const box = (await locator.locator('.canvas-preview').boundingBox())!
      return Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2)
    }
    await expect.poll(() => middle(help)).toBeLessThan(2)
    await expect(help).toHaveAttribute('data-front', 'true')
    // A ring shows where the link went, for a moment.
    await expect(help).toHaveAttribute('data-arrived', '')
    await expect(help).not.toHaveAttribute('data-arrived', '')
    await expect(plain.getByRole('heading')).toHaveText('Plans')
    // The item it went to shows its own first screen, so it has nothing to restart.
    await expect(page.getByRole('button', { name: 'Restart Help page' })).toHaveCount(0)
    // From there too: the same tab stays in that item, and a new tab goes to the nearest item that shows the path, on that screen.
    await help.getByRole('link', { name: 'To checkout' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('This item has no screen for /checkout')
    await expect(plain.getByRole('heading')).toHaveText('Plans')
    await help.getByRole('link', { name: 'Checkout tab' }).click()
    await expect(plain.getByRole('heading')).toHaveText('Checkout')
    // Also when that item was in view already: it goes to the middle.
    await expect.poll(() => middle(page.locator('.canvas-item[data-canvas-item="example"]'))).toBeLessThan(2)
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toHaveAttribute('data-front', 'true')
    await expect(help.getByRole('heading')).toHaveText('Help')
    // That item was moved by a link in another one, so it offers Restart though nobody touched it.
    await page.getByRole('button', { name: 'Fit all' }).click()
    await page.locator('.canvas-item[data-canvas-item="example"] .canvas-name').hover()
    await page.getByRole('button', { name: 'Restart Example · replace me' }).click()
    await expect(plain.getByRole('heading')).toHaveText('Plans')
    // A new-tab link to a path that is also one of the item's own screens leaves the item as it is,
    // and opens the nearest other item that shows it: here the frame below.
    await plain.getByRole('link', { name: 'Checkout tab' }).click()
    await expect(frame.getByRole('heading')).toHaveText('Checkout')
    await expect(plain.getByRole('heading')).toHaveText('Plans')
    await expect(help.getByRole('heading')).toHaveText('Help')
    // A press during the glide stops it there: the person is not held by it.
    await page.getByRole('button', { name: 'Reset view (actual size)' }).click()
    await expect.poll(inView).toBe(false)
    await plain.getByRole('link', { name: 'Help tab' }).click()
    await page.mouse.click(640, 700)
    await page.waitForTimeout(500)
    expect(await middle(help)).toBeGreaterThan(20)
    await page.getByRole('button', { name: 'Fit all' }).click()
    // With no item for it, each says what the link would have done.
    await plain.getByRole('link', { name: 'Lost tab' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Opens in a new tab: /nowhere')
    await plain.getByRole('link', { name: 'Lost', exact: true }).click()
    await expect(page.locator('.canvas-toast')).toContainText('This item has no screen for /nowhere')
    await expect(plain.getByRole('heading')).toHaveText('Plans')
    expect(page.url()).toBe(address)
    expect(errors).toEqual([])
  } finally {
    if (readFileSync(EXAMPLE, 'utf8') !== example) {
      const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
      writeFileSync(EXAMPLE, example)
      await updated
    }
    await restoreRegistry(page, original)
  }
})

test('Start here names the screen and the steps since the start, and `start` opens an item at a later screen', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      EXAMPLE,
      `import { useContext, useState } from "react";
import { RouteContext } from "../canvas/routes";
export const Example = () => (
  <div style={{ padding: 16 }}>
    <h2 style={{ margin: 0, fontSize: 18 }}>Plans</h2>
    <a href="/checkout?plan=team">Choose</a>
  </div>
);
export const Checkout = () => {
  const [review, setReview] = useState(false);
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Checkout</h2>
      <p data-path>{useContext(RouteContext)}</p>
      <label>Company <input /></label>
      <button type="button" onClick={() => setReview(true)}>Review</button>
      {review && <p>Confirm</p>}
    </div>
  );
};
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Checkout, Example } from "./items/Example";')
        .replace('component: Example,', 'component: Example,\n    path: "/plans",\n    screens: { "/checkout": Checkout },')
        .replace(
          /\];\s*$/,
          `  { id: "phone", name: "Phone", component: Example, path: "/plans", screens: { "/checkout": Checkout }, x: 0, y: 260, width: 375, height: 240, viewport: true },
  { id: "started", name: "Started", component: Example, path: "/plans", screens: { "/checkout": Checkout }, start: "/checkout?plan=team", x: 500, y: 260, width: 300, height: 240 },
];
`,
        ),
    )
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "started"'), { timeout: 15_000 })
      .toBe(true)
    await expect
      .poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('Checkout'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const plain = page.locator('.canvas-item[data-canvas-item="example"] .canvas-preview')
    const frame = page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('body')
    await expect(frame.getByRole('heading')).toHaveText('Plans')
    await page.waitForTimeout(600)
    const note = page.locator('.canvas-pin[data-open] textarea')
    for (const [id, name, item] of [
      ['example', 'Example · replace me', plain],
      ['phone', 'Phone', frame],
    ] as const) {
      const more = async () => {
        await page.locator(`.canvas-item[data-canvas-item="${id}"] .canvas-name`).hover()
        await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click()
      }
      // At its start, the item has nowhere else to start.
      await more()
      await expect(page.getByRole('button', { name: `Start ${name} here` })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await item.getByRole('link', { name: 'Choose' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Checkout')
      await item.getByLabel('Company').fill('Acme')
      // A click that changes nothing is not a step.
      await item.getByRole('heading').click()
      await item.getByRole('button', { name: 'Review' }).click()
      await expect(item.getByText('Confirm'), name).toBeVisible()
      // Past the last look for a change after a press (start.ts).
      await page.waitForTimeout(600)
      await more()
      await page.getByRole('button', { name: `Start ${name} here` }).click()
      await expect(note, name).toHaveValue(
        [
          'Start here: make this item, and the versions it is compared with, start where it is now.',
          'Screen: /checkout?plan=team',
          'After:',
          '1. Pressed “Choose”',
          '2. Typed “Acme” in “Company”',
          '3. Pressed “Review”',
        ].join('\n'),
      )
      // It changes this item and the ones beside it in place, not as a new version.
      await expect(page.getByRole('checkbox', { name: 'Apply to a new version' })).not.toBeChecked()
      // Escape takes a new note back.
      await page.keyboard.press('Escape')
      await expect(page.locator('.canvas-pin')).toHaveCount(0)
      // Restart empties the steps along with the item.
      await page.locator(`.canvas-item[data-canvas-item="${id}"] .canvas-name`).hover()
      await page.getByRole('button', { name: `Restart ${name}` }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
    }
    // `start` opens the item at that screen, with its query, and there is nothing to restart.
    const started = page.locator('.canvas-item[data-canvas-item="started"] .canvas-preview')
    await expect(started.getByRole('heading')).toHaveText('Checkout')
    await expect(started.locator('[data-path]')).toHaveText('/checkout')
    await expect(page.getByRole('button', { name: 'Restart Started' })).toHaveCount(0)
    // So does its own page.
    await page.goto('/frame.html?item=started')
    await expect(page.getByRole('heading')).toHaveText('Checkout')
    expect(errors).toEqual([])
  } finally {
    if (readFileSync(EXAMPLE, 'utf8') !== example) {
      const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
      writeFileSync(EXAMPLE, example)
      await updated
    }
    await restoreRegistry(page, original)
  }
})

test('an item opened alone follows its links as on the canvas, and never loads another page', async ({ page, context }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      EXAMPLE,
      `import { type ReactNode, useContext } from "react";
import { BACK_EVENT, NAVIGATE_EVENT } from "../canvas/bridge";
import { RouteContext } from "../canvas/routes";
const push = (href: string) => window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: href }));
function Screen({ title, children }: { title: string; children?: ReactNode }) {
  const path = useContext(RouteContext);
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
      <p data-path>{path}</p>
      {children}
    </div>
  );
}
export const Example = () => (
  <Screen title="Plans">
    <a href="/checkout?plan=team">Choose</a> <a href="/nowhere">Lost</a> <a href="/help" target="_blank">Help tab</a>
    <form><button>Send</button></form>
  </Screen>
);
export const Checkout = () => (
  <Screen title="Checkout">
    <button type="button" onClick={() => push("/done")}>Pay</button>{" "}
    <button type="button" onClick={() => window.dispatchEvent(new Event(BACK_EVENT))}>Back</button>
  </Screen>
);
export const Done = () => (
  <Screen title="Done">
    <a href="/plans">Start over</a>
  </Screen>
);
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Checkout, Done, Example } from "./items/Example";')
        .replace('component: Example,', 'component: Example,\n    path: "/plans",\n    screens: { "/checkout": Checkout, "/done": Done },')
        .replace(
          /\];\s*$/,
          `  { id: "phone", name: "Phone", component: Example, path: "/plans", screens: { "/checkout": Checkout, "/done": Done }, x: 0, y: 260, width: 375, height: 240, viewport: true },
];
`,
        ),
    )
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "phone"'), { timeout: 15_000 })
      .toBe(true)
    await expect
      .poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('Checkout'), { timeout: 15_000 })
      .toBe(true)
    // A viewport item runs in a frame of its own size inside its page; a plain item runs in the page itself.
    for (const [name, id] of [
      ['a frame item', 'phone'],
      ['a plain item', 'example'],
    ] as const) {
      await page.goto(`/frame.html?item=${id}`)
      const item = id === 'phone' ? page.frameLocator('iframe.canvas-frame').locator('body') : page.locator('.canvas-frame-root')
      const frameAddress = () => page.frames().find((frame) => frame !== page.mainFrame())?.url()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
      const address = page.url()
      const inner = frameAddress()
      // A link to one of its screens shows that screen in place. The page stays, and so does its frame:
      // the dev server would answer any other path with the whole canvas.
      await item.getByRole('link', { name: 'Choose' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Checkout')
      await expect(item.locator('[data-path]'), name).toHaveText('/checkout')
      await expect(page.locator('.canvas-toast'), name).toHaveCount(0)
      expect(page.url(), name).toBe(address)
      expect(frameAddress(), name).toBe(inner)
      // A router call goes the same way, and its back() returns.
      await item.getByRole('button', { name: 'Back' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
      await item.getByRole('link', { name: 'Choose' }).click()
      await item.getByRole('button', { name: 'Pay' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Done')
      await item.getByRole('link', { name: 'Start over' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
      // Any other path, a new tab, and a form stay where they are, and say so as the canvas does.
      await item.getByRole('link', { name: 'Lost' }).click()
      await expect(page.locator('.canvas-toast'), name).toContainText('This item has no screen for /nowhere')
      await item.getByRole('link', { name: 'Help tab' }).click()
      await expect(page.locator('.canvas-toast'), name).toContainText('Opens in a new tab: /help')
      await item.getByRole('button', { name: 'Send' }).click()
      await expect(page.locator('.canvas-toast'), name).toContainText("Forms don't submit on the canvas")
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
      expect(context.pages(), name).toHaveLength(1)
      expect(page.url(), name).toBe(address)
      expect(frameAddress(), name).toBe(inner)
      // Nothing about the screen is kept: a reload starts at the first one, as Restart does on the canvas.
      await item.getByRole('link', { name: 'Choose' }).click()
      await expect(item.getByRole('heading'), name).toHaveText('Checkout')
      await page.reload()
      await expect(item.getByRole('heading'), name).toHaveText('Plans')
    }
    expect(errors).toEqual([])
  } finally {
    if (readFileSync(EXAMPLE, 'utf8') !== example) {
      const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
      writeFileSync(EXAMPLE, example)
      await updated
    }
    await restoreRegistry(page, original)
  }
})

test('an item that was used can be restarted by itself, in a frame too', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    // An item with steps, as a flow has: "Next" goes on, and nothing goes back.
    writeFileSync(
      EXAMPLE,
      `import { useState } from "react";
export function Example() {
  const [step, setStep] = useState(1);
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Step {step}</h2>
      <button type="button" onClick={() => setStep(step + 1)}>Next</button>
    </div>
  );
}
`,
    )
    writeFileSync(
      REGISTRY,
      original.replace(
        /\];\s*$/,
        '  { id: "phone", name: "Phone", component: Example, x: 0, y: 240, width: 375, height: 180, viewport: true },\n];\n',
      ),
    )
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "phone"'), { timeout: 15_000 })
      .toBe(true)
    await expect
      .poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('setStep'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const contents = {
      example: page.locator('.canvas-item[data-canvas-item="example"] .canvas-preview'),
      phone: page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('body'),
    }
    const restarts = {
      example: page.getByRole('button', { name: 'Restart Example · replace me' }),
      phone: page.getByRole('button', { name: 'Restart Phone' }),
    }
    await expect(contents.phone.getByRole('heading')).toHaveText('Step 1')
    await page.waitForTimeout(600)
    // Not there until the item was used.
    await expect(page.getByRole('button', { name: /^Restart / })).toHaveCount(0)
    for (const id of ['example', 'phone'] as const) {
      const other = id === 'example' ? 'phone' : 'example'
      await contents[id].getByRole('button', { name: 'Next' }).click()
      await contents[id].getByRole('button', { name: 'Next' }).click()
      await expect(contents[id].getByRole('heading')).toHaveText('Step 3')
      // Only on the item that was used. It restarts that item and no other, with no page reload.
      await expect(restarts[id]).toHaveCount(1)
      await expect(restarts[other]).toHaveCount(0)
      await page.evaluate(() => ((window as unknown as { __samePage: boolean }).__samePage = true))
      await page.locator(`.canvas-item[data-canvas-item="${id}"] .canvas-name`).hover()
      await restarts[id].click()
      await expect(contents[id].getByRole('heading')).toHaveText('Step 1')
      await expect(restarts[id]).toHaveCount(0)
      expect(await page.evaluate(() => (window as unknown as { __samePage?: boolean }).__samePage)).toBe(true)
      // It can be used and restarted again.
      await contents[id].getByRole('button', { name: 'Next' }).click()
      await expect(contents[id].getByRole('heading')).toHaveText('Step 2')
      await expect(restarts[id]).toHaveCount(1)
      await page.locator(`.canvas-item[data-canvas-item="${id}"] .canvas-name`).hover()
      await restarts[id].click()
      await expect(contents[id].getByRole('heading')).toHaveText('Step 1')
    }
    // A click in Ask agent mode does not use the item: the button is not pressed, and no Restart shows.
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    await contents.example.getByRole('button', { name: 'Next' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(contents.example.getByRole('heading')).toHaveText('Step 1')
    await page.waitForTimeout(700)
    await expect(page.getByRole('button', { name: /^Restart / })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    if (readFileSync(EXAMPLE, 'utf8') !== example) {
      const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
      writeFileSync(EXAMPLE, example)
      await updated
    }
    await restoreRegistry(page, original)
  }
})

test('a pin stays on its element when its item is resized, in a frame too', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    const phoned = original.replace(
      /\];\s*$/,
      '  { id: "phone", name: "Phone", component: Example, x: 0, y: 240, width: 375, height: 180, viewport: true },\n];\n',
    )
    expect(phoned).not.toBe(original)
    writeFileSync(REGISTRY, phoned)
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "phone"'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const ids = ['example', 'phone'] as const
    const texts = {
      example: page.locator('.canvas-item[data-canvas-item="example"] .canvas-preview p'),
      phone: page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('p'),
    }
    await expect(texts.phone).toBeVisible()
    await page.waitForTimeout(600)
    // Where an item's pin is within its text, as a share of the text's width.
    const place = async (id: (typeof ids)[number]) => {
      const box = (await texts[id].boundingBox())!
      const pin = await page
        .locator(`.canvas-item[data-canvas-item="${id}"] .canvas-pin`)
        .evaluate((element) => element.getBoundingClientRect().x)
      return { share: (pin - box.x) / box.width, width: box.width }
    }
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    for (const id of ids) {
      // Near the end of the first line: a point that moves when the text gets wider.
      const box = (await texts[id].boundingBox())!
      await page.mouse.click(box.x + box.width * 0.8, box.y + 6)
      const note = page.getByRole('dialog', { name: /^Ask agent about/ })
      await note.getByRole('textbox').fill('Shorter')
      await note.getByRole('textbox').press('Enter')
      await expect(note).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    for (const id of ids) {
      const before = await place(id)
      expect(Math.abs(before.share - 0.8), id).toBeLessThan(0.03)
      const edge = (await page.locator(`.canvas-item[data-canvas-item="${id}"] .canvas-item-edge[data-edge="e"]`).boundingBox())!
      await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2)
      await page.mouse.down()
      await page.mouse.move(edge.x + edge.width / 2 + 100, edge.y + edge.height / 2, { steps: 6 })
      await page.mouse.up()
      // The text is wider now, and the pin is at the same place in it: it went with the text.
      // (A framed item lays out again only once its new size is saved, a moment later.)
      await expect.poll(async () => (await place(id)).width, { message: id, timeout: 15_000 }).toBeGreaterThan(before.width + 50)
      await expect.poll(async () => Math.abs((await place(id)).share - before.share), { message: id }).toBeLessThan(0.03)
    }
    // The new places are kept. place() reads the text and then the pin, so it is asked until the
    // page is still: one read during the reload once caught the text before the camera was applied
    // and the pin after it, on GitHub's slower runner.
    await page.reload()
    await expect(texts.phone).toBeVisible()
    for (const id of ids) await expect.poll(async () => Math.abs((await place(id)).share - 0.8), { message: id }).toBeLessThan(0.03)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('a dialog that a viewport item portals is the item too: Ask agent names its elements, and the pin stays on them', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    // As products draw a search dialog: portaled to the body, the item's own root left empty. The
    // button sits at the dialog's right end, so it moves when the item gets wider.
    writeFileSync(
      EXAMPLE,
      `import { useState } from "react";
import { createPortal } from "react-dom";
${example}
export function Portaled() {
  const [opened, setOpened] = useState("");
  return createPortal(
    <div role="dialog" aria-label="Search" style={{ position: "fixed", top: 16, left: 16, right: 16, padding: 16, background: "white" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={() => setOpened("Acme MSA")}>Acme MSA</button>
      </div>
      <p>{opened ? \`Opened \${opened}\` : "Nothing opened"}</p>
    </div>,
    document.body,
  );
}
`,
    )
    const withDialog = original
      .replace('import { Example } from "./items/Example";', 'import { Example, Portaled } from "./items/Example";')
      .replace(/\];\s*$/, '  { id: "search", name: "Search", component: Portaled, x: 0, y: 240, width: 420, height: 220, viewport: true },\n];\n')
    expect(withDialog).toContain('Portaled }')
    writeFileSync(REGISTRY, withDialog)
    await expect
      .poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('id: "search"'), { timeout: 15_000 })
      .toBe(true)
    await expect
      .poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('createPortal'), { timeout: 15_000 })
      .toBe(true)
    await page.goto('/')
    const frame = page.frameLocator('.canvas-item[data-canvas-item="search"] iframe')
    const button = frame.getByRole('button', { name: 'Acme MSA' })
    const status = frame.getByRole('dialog', { name: 'Search' }).locator('p')
    await expect(status).toHaveText('Nothing opened')
    await page.waitForTimeout(600)

    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    // Hovering outlines the dialog's button, as it does an element in the item's root.
    const at = (await button.boundingBox())!
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
    await expect(frame.locator('.canvas-pick')).toBeVisible()
    // A click names it and places a pin on it; the product's button is not pressed.
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2)
    const note = page.getByRole('dialog', { name: 'Ask agent about Search › button “Acme MSA”' })
    await expect(note).toBeVisible()
    await expect(status).toHaveText('Nothing opened')
    await note.getByRole('textbox').fill('Name the type too')
    await note.getByRole('textbox').press('Enter')
    await expect(note).toHaveCount(0)
    const pin = page.locator('.canvas-item[data-canvas-item="search"] .canvas-pin')
    const onButton = async () => {
      const box = (await button.boundingBox())!
      const point = await pin.evaluate((element) => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y }
      })
      return point.x >= box.x - 2 && point.x <= box.x + box.width + 2 && point.y >= box.y - 2 && point.y <= box.y + box.height + 2
    }
    expect(await onButton()).toBe(true)
    // The frame's empty space is no element of the item: a press there opens no note.
    const item = (await page.locator('.canvas-item[data-canvas-item="search"] iframe').boundingBox())!
    await page.mouse.click(item.x + 20, item.y + item.height - 30)
    await expect(page.getByRole('dialog', { name: /^Ask agent about/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()

    // Wider, the button moves right, and its pin goes with it: it is found in the dialog again.
    const before = (await button.boundingBox())!.x
    const edge = (await page.locator('.canvas-item[data-canvas-item="search"] .canvas-item-edge[data-edge="e"]').boundingBox())!
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2)
    await page.mouse.down()
    await page.mouse.move(edge.x + edge.width / 2 + 120, edge.y + edge.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => (await button.boundingBox())!.x, { timeout: 15_000 }).toBeGreaterThan(before + 80)
    await expect.poll(onButton).toBe(true)

    // Pressing the dialog's button uses the item, so it can be restarted.
    await button.click()
    await expect(status).toHaveText('Opened Acme MSA')
    await expect(page.getByRole('button', { name: 'Restart Search' })).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
    if (readFileSync(EXAMPLE, 'utf8') !== example) {
      const updated = page.waitForEvent('console', { predicate: (m) => m.text().includes('hot updated'), timeout: 10_000 }).catch(() => {})
      writeFileSync(EXAMPLE, example)
      await updated
    }
  }
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
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    await page.locator('.canvas-preview h2').click()
    const note = page.getByRole('dialog', { name: /^Ask agent about/ })
    await note.getByRole('textbox').fill('Shorter title')
    await note.getByRole('textbox').press('Enter')
    await page.getByRole('button', { name: 'Send 1 to agent' }).click()
    await expect(page.locator('.canvas-toast')).toContainText('Sent 1 to the agent')
    expect(await exited).toBe(0)
    expect(output).toContain('Annotations from the design canvas (1):')
    expect(output).toContain('Shorter title')
    await expect(page.getByRole('button', { name: 'Sent to the agent: Shorter title' })).toBeVisible()
  } finally {
    listener.kill()
  }
  expect(errors).toEqual([])
})

test('the item the agent works on says so until it listens again', async ({ page, baseURL }) => {
  const errors = collectErrors(page)
  const listen = () => {
    // Its own process group, so stopping it also ends the connection listen.sh opened,
    // and the next test does not find an agent still listening.
    const child = spawn('bash', [LISTEN, baseURL!], { detached: true })
    const stop = () => {
      try {
        process.kill(-child.pid!)
      } catch {
        // Already gone.
      }
    }
    return { child, stop, exited: new Promise<number | null>((resolve) => child.on('exit', resolve)) }
  }
  const first = listen()
  let again: ReturnType<typeof listen> | undefined
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
    await page.locator('.canvas-preview h2').click()
    const note = page.getByRole('dialog', { name: /^Ask agent about/ })
    await note.getByRole('textbox').fill('Shorter title')
    await note.getByRole('textbox').press('Enter')
    await page.getByRole('button', { name: 'Send 1 to agent' }).click()
    expect(await first.exited).toBe(0)
    // The item the note is on says so, with a light around it; no bar at the top, nothing is left to apply.
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    const status = item.locator('.canvas-ghost-tag[data-state="working"]')
    await expect(status).toHaveText('Agent working')
    await expect(item).toHaveAttribute('data-working')
    await expect(item.locator('.canvas-beam')).toHaveCount(1)
    await expect(page.getByRole('group', { name: 'Not sent to the agent yet' })).toHaveCount(0)
    // listen.sh again: the agent handled what it printed.
    again = listen()
    await expect(status).toHaveCount(0)
    await expect(item).not.toHaveAttribute('data-working')
    // The beam fades out, then goes.
    await expect(item.locator('.canvas-beam')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.locator('.canvas-toast')).toContainText('The agent finished')
  } finally {
    first.stop()
    again?.stop()
  }
  expect(errors).toEqual([])
})

test('a kept listener stays working until the agent says done', async ({ page, request }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  // The Codex listener's side: it listens with keep=1 and reconnects right after each message.
  const kept = () => request.get('/__design-canvas/agent/listen?timeout=30&keep=1')
  const firstPoll = kept()
  await expect(page.getByRole('button', { name: 'Ask agent', exact: true })).toBeVisible()
  await expect.poll(async () => (await (await request.get('/__design-canvas/agent')).json()).state).toBe('listening')
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  await page.locator('.canvas-preview h2').click()
  const note = page.getByRole('dialog', { name: /^Ask agent about/ })
  await note.getByRole('textbox').fill('Shorter title')
  await note.getByRole('textbox').press('Enter')
  await page.getByRole('button', { name: 'Send 1 to agent' }).click()
  expect((await firstPoll).status()).toBe(200)
  const secondPoll = kept()
  const status = page.locator('.canvas-item[data-canvas-item="example"] .canvas-ghost-tag[data-state="working"]')
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
  // And an item in the trash, which the shared file must not show on the canvas.
  const added =
    '  { id: "phone", name: "Phone", component: Example, x: 0, y: 240, width: 375, height: 180, viewport: true },\n' +
    '  { id: "old", name: "Old", component: Example, x: 400, y: 0, width: 360, height: 180, trashed: true },\n];'
  // And a reference image, whose picture must be inside the file.
  const withImage = registry
    .replace(/\];\s*$/, `${added}\n`)
    .replace('export const images: CanvasImage[] = [];', 'export const images: CanvasImage[] = [\n  { id: "ref", file: "ref.png", x: 400, y: 240, width: 120, height: 120 },\n];')
  expect(withImage).toContain('file: "ref.png"')
  // And an item that loads a file from the app's public folder through a path helper that
  // rejects anything but a root path, as apps with a base path do. Swapping the path in
  // the code for the file made the helper throw and left the whole shared file blank.
  const withLogo = withImage
    .replace('import { Example } from "./items/Example";', 'import { Example } from "./items/Example";\nimport { Logo } from "./items/Logo";')
    .replace(/\];\s*$/, '  { id: "logo", name: "Logo", component: Logo, x: 800, y: 0, width: 200, height: 120 },\n];\n')
  expect(withLogo).toContain('component: Logo')
  writeFileSync(`${copy}/registry.tsx`, withLogo)
  writeFileSync(
    `${copy}/items/Logo.tsx`,
    'const withBase = (path: string) => {\n' +
      '  if (!path.startsWith("/")) throw new Error(`withBase expects a root path, got ${path.slice(0, 30)}`);\n' +
      '  return path;\n' +
      '};\n' +
      'const LOGO = withBase("/smoke-logo.png");\n' +
      'export function Logo() {\n' +
      '  return <img alt="Logo" src={LOGO} data-path={LOGO} />;\n' +
      '}\n',
  )
  const hadPublic = existsSync('public')
  mkdirSync('public', { recursive: true })
  writeFileSync('public/smoke-logo.png', Buffer.from(DOT_PNG, 'base64'))
  mkdirSync(`${copy}/images`, { recursive: true })
  writeFileSync(`${copy}/images/ref.png`, Buffer.from(DOT_PNG, 'base64'))
  const folder = mkdtempSync(join(tmpdir(), 'design-canvas-share-'))
  const file = join(folder, 'canvas.html')
  try {
    const shared = spawnSync('bash', [SHARE, copy, file], { encoding: 'utf8' })
    expect(shared.status, shared.stderr).toBe(0)
    const url = pathToFileURL(file).href
    await page.goto(url)
    const example = page.locator('.canvas-item[data-canvas-item="example"]')
    await expect(example).toContainText('Canvas is ready')
    await expect(example.locator('h2')).toHaveCSS('color', APP_TEXT)
    await expect(page.locator('.canvas-item[data-canvas-item="old"]')).toHaveCount(0)
    // The reference image shows from inside the file, and cannot be moved there.
    const picture = page.locator('.canvas-image[data-canvas-image="ref"]')
    await expect.poll(() => picture.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)
    await expect(picture).not.toHaveAttribute('data-interactive')
    // The public-folder file shows from inside the file, and the item's code still held its path.
    const logo = page.locator('.canvas-item[data-canvas-item="logo"] img')
    await expect(logo).toHaveAttribute('data-path', '/smoke-logo.png')
    await expect.poll(() => logo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)
    // A shared file is read-only: no trash to open and nothing to move into it.
    await expect(page.getByRole('button', { name: /^Trash/ })).toHaveCount(0)
    await page.getByRole('button', { name: /^More actions for / }).first().click()
    await expect(page.getByRole('link', { name: /in a new tab/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /to the trash$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Copy the name / })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Ask agent', exact: true })).toHaveCount(0)
    // The controls that need an agent, or save, are not in its help.
    await page.getByRole('button', { name: 'Canvas controls' }).click()
    await expect(page.locator('#canvas-help')).toBeVisible()
    await expect(page.locator('#canvas-help')).toContainText('Move around')
    await expect(page.locator('#canvas-help')).not.toContainText('Ask the agent')
    await expect(page.locator('#canvas-help')).not.toContainText('Undo')
    await page.keyboard.press('Escape')
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
    await expect(example).toContainText('Canvas is ready')
    // The same file shows one item alone.
    await page.goto(`${url}?item=example`)
    await expect(page.locator('.canvas-frame-root')).toContainText('Canvas is ready')
    await expect(page.locator('.canvas-frame-root h2')).toHaveCSS('color', APP_TEXT)
    // Shown inside another page, as a preview pane or an embed shows it, the file
    // is loaded from memory and has no address to reopen; its frames still load,
    // and a wheel over one still pans the canvas.
    const markup = readFileSync(file, 'utf8')
    await page.route('http://embed.test/', (route) =>
      route.fulfill({ body: '<!doctype html><title>Host</title>', contentType: 'text/html' }),
    )
    for (const way of ['blob', 'srcdoc'] as const) {
      await page.goto('http://embed.test/')
      await page.evaluate(
        ([html, how]) => {
          const host = document.createElement('iframe')
          host.style.cssText = 'width:1000px;height:700px;border:0'
          if (how === 'blob') host.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
          else host.srcdoc = html
          document.body.append(host)
        },
        [markup, way],
      )
      const hosted = page.frameLocator('iframe').first()
      await expect(hosted.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('body'), way).toContainText(
        'Canvas is ready',
      )
      // Inside another page an item has no address of its own, and a shared file cannot trash: no More menu.
      await expect(hosted.getByRole('button', { name: /^More actions for / }), way).toHaveCount(0)
      await page.keyboard.press('Escape')
      const embeddedWorld = hosted.locator('.canvas-world')
      const start = await embeddedWorld.evaluate((element) => getComputedStyle(element).transform)
      const phone = await hosted.locator('.canvas-item[data-canvas-item="phone"] iframe').boundingBox()
      await page.mouse.move(phone!.x + 40, phone!.y + 40)
      await page.mouse.wheel(0, 120)
      await expect
        .poll(() => embeddedWorld.evaluate((element) => getComputedStyle(element).transform), { message: way })
        .not.toBe(start)
    }
  } finally {
    rmSync(copy, { recursive: true, force: true })
    rmSync(hadPublic ? 'public/smoke-logo.png' : 'public', { recursive: true, force: true })
  }
  expect(errors).toEqual([])
})

test('Share downloads the canvas as one file, without reloading the canvas', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
  // The build runs inside the dev server; a page reload during it would lose this.
  await page.evaluate(() => Object.assign(window, { kept: true }))
  // Share opens a panel first. Escape closes it.
  await page.getByRole('button', { name: 'Share as an HTML file' }).click()
  const panel = page.getByRole('dialog', { name: 'Share as a file' })
  await expect(panel).toContainText('Opens in any browser.')
  // A canvas without sections has nothing to choose.
  await expect(panel.locator('select')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Download' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Share as an HTML file' })).toBeFocused()
  await page.getByRole('button', { name: 'Share as an HTML file' }).click()
  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Download' }).click()
  const file = await download
  // Named for the canvas's title, with the day.
  expect(file.suggestedFilename()).toMatch(/^Smoke \d{4}-\d{2}-\d{2}\.html$/)
  await expect(page.locator('.canvas-toast')).toContainText(`Downloaded ${file.suggestedFilename()}`)
  await expect(panel).toHaveCount(0)
  expect(await page.evaluate(() => 'kept' in window)).toBe(true)
  const path = join(mkdtempSync(join(tmpdir(), 'design-canvas-share-')), file.suggestedFilename())
  await file.saveAs(path)
  await page.goto(pathToFileURL(path).href)
  await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
  await expect(page.getByRole('button', { name: 'Share as an HTML file' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Share can share one section: the rest is not in the file at all', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  try {
    const errors = collectErrors(page)
    // A section away from the example item, with a note in it.
    writeFileSync(
      REGISTRY,
      original
        .replace('export const notes: CanvasNote[] = [];', 'export const notes: CanvasNote[] = [\n  { id: "corner-note", text: "Only this corner", x: 3050, y: 3050 },\n];')
        .replace('export const sections: CanvasSection[] = [];', 'export const sections: CanvasSection[] = [\n  { id: "corner", title: "Corner", x: 3000, y: 3000, width: 500, height: 400 },\n];'),
    )
    await expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('Only this corner')).toBe(true)
    await page.goto('/')
    await expect(page.locator('.canvas-item[data-canvas-item="example"]')).toContainText('Canvas is ready')
    await page.getByRole('button', { name: 'Share as an HTML file' }).click()
    const panel = page.getByRole('dialog', { name: 'Share as a file' })
    await expect(panel.locator('select option')).toHaveText(['Whole canvas · 1 item', 'Corner · 0 items'])
    await panel.locator('select').selectOption('corner')
    const download = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Download' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^Smoke · Corner \d{4}-\d{2}-\d{2}\.html$/)
    const html = readFileSync((await file.path())!, 'utf8')
    expect(html).toContain('Only this corner')
    // The example item's own words are not in the file, not only hidden.
    expect(html).not.toContain('Canvas is ready')
    expect(errors).toEqual([])
  } finally {
    await restoreRegistry(page, original)
  }
})

test('only the canvas page can build a shared file', async ({ request }) => {
  const other = await request.post('/__design-canvas/share', { headers: { Origin: 'http://evil.test' } })
  expect(other.status()).toBe(403)
})

test('cursors say what a press or drag will do', async ({ page }) => {
  await page.goto('/')
  const cursor = (selector: string) => page.locator(selector).first().evaluate((element) => getComputedStyle(element).cursor)
  // With the default tool a drag on empty canvas selects, so the pointer there is the plain arrow.
  expect(await cursor('.canvas-viewport')).toBe('default')
  expect(await cursor('.canvas-name')).toBe('grab')
  expect(await cursor('.canvas-handle')).toBe('grab')
  expect(await cursor('.canvas-preview h2')).toBe('auto')
  // A note is placed with an arrow that carries a note, and falls back to the crosshair.
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  expect(await cursor('.canvas-viewport')).toMatch(/^url\(.*\) 5 3, crosshair$/)
  await page.keyboard.press('Escape')
  // Asking: an arrow that carries a speech bubble over what can be asked about, and empty canvas pans.
  await page.getByRole('button', { name: 'Ask agent', exact: true }).click()
  expect(await cursor('.canvas-preview h2')).toMatch(/^url\(.*\) 5 3, crosshair$/)
  expect(await cursor('.canvas-name')).toMatch(/^url\(.*\) 5 3, crosshair$/)
  expect(await cursor('.canvas-viewport')).toBe('grab')
  await page.locator('.canvas-viewport').evaluate((element) => element.setAttribute('data-gesture', 'pan'))
  expect(await cursor('.canvas-preview h2')).toBe('grabbing')
  // Z held wins over the crosshair and the copy cursor; Alt turns it to zoom out.
  await page.locator('.canvas-viewport').evaluate((element) => {
    element.removeAttribute('data-gesture')
    element.setAttribute('data-alt', '')
    element.setAttribute('data-zoom', 'in')
  })
  expect(await cursor('.canvas-preview h2')).toBe('zoom-in')
  expect(await cursor('.canvas-name')).toBe('zoom-in')
  await page.locator('.canvas-viewport').evaluate((element) => element.setAttribute('data-zoom', 'out'))
  expect(await cursor('.canvas-preview h2')).toBe('zoom-out')
})

test('an item with screens opens its flow: every screen side by side, with arrows, and a press opens one', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      EXAMPLE,
      `import { NAVIGATE_EVENT } from "../canvas/bridge";
const push = (href: string) => window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: href }));
export const Example = () => (
  <div style={{ padding: 16 }}>
    <h2>Plans</h2>
    <a href="/checkout">Continue</a> <a href="/help" target="_blank">Help tab</a>
  </div>
);
export const Checkout = () => (
  <div style={{ padding: 16 }}>
    <h2>Checkout</h2>
    <button type="button" onClick={() => push("/done")}>Pay</button> <a href="/plans">Back</a>
  </div>
);
export const Done = () => (
  <div style={{ padding: 16 }}>
    <h2>Done</h2>
    <a href="/plans">Start over</a>
  </div>
);
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Checkout, Done, Example } from "./items/Example";')
        .replace('component: Example,', 'component: Example,\n    path: "/plans",\n    screens: { "/checkout": Checkout, "/done": Done },')
        .replace(
          /\];\s*$/,
          `  { id: "phone", name: "Phone", component: Example, path: "/plans", screens: { "/checkout": Checkout, "/done": Done }, x: 0, y: 260, width: 375, height: 200, viewport: true },
  { id: "single", name: "Single", component: Done, x: 500, y: 260, width: 300, height: 160 },
];
`,
        ),
    )
    await servesId(page, 'single')
    await expect.poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('Pay'), { timeout: 15_000 }).toBe(true)
    await page.goto('/')
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    await expect(item.locator('h2')).toHaveText('Plans')
    // Only an item that holds more than one screen says so.
    await expect(page.locator('.canvas-item[data-canvas-item="single"] .canvas-item-screens')).toHaveCount(0)
    const show = page.getByRole('button', { name: 'Show the 3 screens of Example · replace me' })
    await expect(show).toHaveText('3')
    // Its hint says what a press does.
    await expect(show).toHaveAttribute('data-tip', 'Show the flow: 3 screens')

    await show.click()
    const view = page.getByRole('dialog', { name: 'Screens of Example · replace me' })
    await expect(view.locator('.canvas-flow-path')).toHaveText(['/plans', '/checkout', '/done'])
    await expect(view.locator('.canvas-flow-screen h2')).toHaveText(['Plans', 'Checkout', 'Done'])
    await expect(view.locator('.canvas-flow-screen h2').first()).toHaveCSS('color', APP_TEXT)
    // Arrows for the links: on to checkout, and back to plans twice. A new-tab link and a router call have none.
    await expect(view.locator('.canvas-flow-arrows > g > path')).toHaveCount(3)
    // Each arrow says what makes the step, in the link's words.
    await expect(view.locator('.canvas-flow-arrows text')).toHaveText(['click "Continue"', 'click "Back"', 'click "Start over"'])
    // The screens are pictures: a press on a link in one does not follow it.
    await expect(view.locator('.canvas-flow-live').first()).toHaveJSProperty('inert', true)
    // It pans and zooms like the canvas: buttons, keys, and Ctrl + wheel. Words on arrows scale with it, as names do.
    const level = view.locator('.canvas-flow-zoom-level')
    const percent = async () => Number((await level.textContent())!.replace('%', ''))
    const fit = await percent()
    const words = view.locator('.canvas-flow-arrows text').first()
    const wordsHeight = (await words.boundingBox())!.height
    const nameHeight = (await view.locator('.canvas-flow-path').first().boundingBox())!.height
    // Zoomed in, the words and the screens' names keep their size on screen: they do not grow
    // taller than the screens' own headings. Zoomed out, they shrink with the view.
    await view.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(percent).toBeGreaterThan(fit)
    await page.keyboard.press('+')
    await page.keyboard.press('+')
    // Within a little: text at a small layout size, scaled up, has its box rounded differently.
    expect(Math.abs((await words.boundingBox())!.height - wordsHeight) / wordsHeight).toBeLessThan(0.15)
    expect((await view.locator('.canvas-flow-path').first().boundingBox())!.height).toBeLessThan(nameHeight * 1.1)
    await page.keyboard.press('1')
    await page.keyboard.press('-')
    await page.keyboard.press('-')
    await expect.poll(async () => (await words.boundingBox())!.height).toBeLessThan(wordsHeight * 0.85)
    await page.keyboard.press('0')
    await expect(level).toHaveText('100%')
    await page.keyboard.press('1')
    await expect.poll(percent).toBe(fit)
    await page.mouse.move(400, 400)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -200)
    await page.keyboard.up('Control')
    await expect.poll(percent).toBeGreaterThan(fit)
    // A drag pans, also when it starts on a screen, and opens nothing.
    const before = (await view.locator('.canvas-flow-screen').first().boundingBox())!.x
    const second = (await view.locator('.canvas-flow-frame').nth(1).boundingBox())!
    await page.mouse.move(second.x + 30, second.y + 30)
    await page.mouse.down()
    await page.mouse.move(second.x + 130, second.y + 30, { steps: 5 })
    await page.mouse.up()
    await expect(view).toBeVisible()
    await page.mouse.move(600, 650)
    await page.mouse.down()
    await page.mouse.move(700, 650, { steps: 5 })
    await page.mouse.up()
    await expect(view).toBeVisible()
    await expect.poll(async () => (await view.locator('.canvas-flow-screen').first().boundingBox())!.x).toBeGreaterThan(before + 150)
    // Empty space: the stage's bottom left corner, clear of the screens and the bars.
    const emptySpace = async () => {
      const stage = (await view.locator('.canvas-flow-stage').boundingBox())!
      await page.mouse.click(stage.x + 40, stage.y + stage.height - 40)
    }
    // A press on empty space is inside the view: it keeps the view, and where it is.
    const panned = (await view.locator('.canvas-flow-screen').first().boundingBox())!.x
    await emptySpace()
    await expect(view).toBeVisible()
    expect((await view.locator('.canvas-flow-screen').first().boundingBox())!.x).toBe(panned)
    await page.keyboard.press('Escape')
    await expect(view).toHaveCount(0)

    // A step made by a router call gets its arrow once the person has made it.
    await item.getByRole('link', { name: 'Continue' }).click()
    await item.getByRole('button', { name: 'Pay' }).click()
    await expect(item.locator('h2')).toHaveText('Done')
    await show.click()
    await expect(view.locator('.canvas-flow-arrows > g > path')).toHaveCount(4)
    // A router call is named by the button pressed to make it.
    await expect(view.locator('.canvas-flow-arrows text')).toContainText(['click "Pay"'])
    await expect(view.locator('.canvas-flow-screen[data-current] h2')).toHaveText('Done')
    // A press on a screen brings it close, and the view stays; a second one shows the whole flow again.
    await page.keyboard.press('1')
    const whole = await percent()
    await view.getByRole('button', { name: 'Zoom to /checkout' }).click()
    await expect.poll(percent).toBe(100)
    const stage = (await view.locator('.canvas-flow-stage').boundingBox())!
    const offCentre = async () => {
      const frame = (await view.locator('.canvas-flow-frame').nth(1).boundingBox())!
      return Math.abs(frame.x + frame.width / 2 - (stage.x + stage.width / 2))
    }
    await expect.poll(offCentre).toBeLessThan(4)
    await expect(item.locator('h2')).toHaveText('Done')
    await view.getByRole('button', { name: 'Show the whole flow' }).click()
    await expect.poll(percent).toBe(whole)
    // Its name row's Try opens the item there, back on the canvas.
    await view.locator('.canvas-flow-screen').nth(1).hover()
    await view.getByRole('button', { name: 'Try /checkout on the canvas' }).click()
    await expect(view).toHaveCount(0)
    await expect(item.locator('h2')).toHaveText('Checkout')

    // Ask agent about one screen: the note opens there, on that screen, and nothing else moves.
    await show.click()
    await view.locator('.canvas-flow-screen').nth(2).hover()
    await view.getByRole('button', { name: 'Ask agent about /done' }).click()
    const screenNote = page.getByRole('dialog', { name: /Example · replace me › screen \/done/ })
    await expect(view.locator('.canvas-flow-screen').nth(2).getByRole('dialog')).toBeVisible()
    await expect(item.locator('h2')).toHaveText('Checkout')
    await screenNote.getByRole('textbox').fill('Drop this step.')
    await screenNote.getByRole('textbox').press('Enter')
    await expect(screenNote).toHaveCount(0)
    await expect(view.locator('.canvas-flow-screen').nth(2).locator('.canvas-pin')).toHaveCount(1)
    // And about the whole flow, from the view's bar. Escape closes the note first, then the view.
    await view.getByRole('button', { name: 'Ask agent about the whole flow of Example · replace me' }).click()
    const flowNote = page.getByRole('dialog', { name: /Example · replace me › the whole flow \(\/plans → \/checkout → \/done\)/ })
    await expect(flowNote).toBeVisible()
    // Typing in it types: A, N, S, V, and the zoom keys are the canvas's only outside a field.
    await page.keyboard.type('Are 3 steps - too many? 1 0')
    await expect(flowNote.getByRole('textbox')).toHaveValue('Are 3 steps - too many? 1 0')
    await flowNote.getByRole('textbox').fill('')
    await page.keyboard.press('Escape')
    await expect(view).toBeVisible()
    // A press on empty space closes the note, and only the note.
    await view.getByRole('button', { name: 'Ask agent about the whole flow of Example · replace me' }).click()
    await expect(flowNote).toBeVisible()
    await emptySpace()
    await expect(flowNote).toHaveCount(0)
    await expect(view).toBeVisible()
    // The Ask agent tool, as on the canvas: A, then a click on an element asks about it on its screen.
    const askTool = view.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Ask agent' })
    await page.keyboard.press('a')
    await expect(askTool).toHaveAttribute('aria-pressed', 'true')
    await view.locator('.canvas-flow-screen').nth(1).getByRole('button', { name: 'Pay' }).click()
    const elementNote = page.getByRole('dialog', { name: /Example · replace me › screen \/checkout › button “Pay”/ })
    await expect(elementNote).toBeVisible()
    // The press asked; the screen's own button did nothing.
    await expect(item.locator('h2')).toHaveText('Checkout')
    await elementNote.getByRole('textbox').fill('Say the price on the button.')
    await elementNote.getByRole('textbox').press('Enter')
    await expect(view.locator('.canvas-flow-screen').nth(1).locator('.canvas-flow-pins[data-at="point"] .canvas-pin')).toHaveCount(1)
    // Escape puts the tool down first, then closes the view.
    await page.keyboard.press('Escape')
    await expect(askTool).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Escape')
    await expect(view).toHaveCount(0)
    // The notes wait on the item, like any other.
    await expect(item.locator('.canvas-pin')).toHaveCount(2)

    // A frame item: its screens are frames, and their links give arrows too.
    await page.getByRole('button', { name: 'Show the 3 screens of Phone' }).click()
    const phone = page.getByRole('dialog', { name: 'Screens of Phone' })
    await expect(phone.locator('iframe')).toHaveCount(3)
    await expect(phone.frameLocator('iframe').nth(2).locator('h2')).toHaveText('Done')
    await expect(phone.locator('.canvas-flow-arrows > g > path')).toHaveCount(3)
    await phone.locator('.canvas-flow-screen').nth(2).hover()
    await phone.getByRole('button', { name: 'Try /done on the canvas' }).click()
    await expect(page.frameLocator('.canvas-item[data-canvas-item="phone"] iframe').locator('h2')).toHaveText('Done')
    expect(errors).toEqual([])
  } finally {
    writeFileSync(EXAMPLE, example)
    await restoreRegistry(page, original)
  }
})

test('a link that shows only after a press gets its arrow in its own words', async ({ page }) => {
  // Found filming the promo: Continue became a link only once a plan was picked, and the
  // arrow took the words of the plan press ("click "Team"") instead of "click "Continue"".
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      EXAMPLE,
      `import { useState } from "react";
export const Example = () => {
  const [plan, setPlan] = useState(false);
  return (
    <div style={{ padding: 16 }}>
      <h2>Plans</h2>
      <button type="button" onClick={() => setPlan(true)}>Team</button>
      {plan ? <a href="/checkout">Continue</a> : <button type="button" disabled>Continue</button>}
    </div>
  );
};
export const Checkout = () => (
  <div style={{ padding: 16 }}>
    <h2>Checkout</h2>
  </div>
);
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Checkout, Example } from "./items/Example";')
        .replace('component: Example,', 'component: Example,\n    path: "/plans",\n    screens: { "/checkout": Checkout },'),
    )
    await expect.poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('setPlan'), { timeout: 15_000 }).toBe(true)
    await page.goto('/')
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    await expect(item.locator('h2')).toHaveText('Plans')
    await item.getByRole('button', { name: 'Team' }).click()
    await item.getByRole('link', { name: 'Continue' }).click()
    await expect(item.locator('h2')).toHaveText('Checkout')
    await page.getByRole('button', { name: 'Show the 2 screens of Example · replace me' }).click()
    const view = page.getByRole('dialog', { name: 'Screens of Example · replace me' })
    await expect(view.locator('.canvas-flow-arrows text')).toHaveText(['click "Continue"'])
    expect(errors).toEqual([])
  } finally {
    writeFileSync(EXAMPLE, example)
    await restoreRegistry(page, original)
  }
})

test('a flow with a branch lays the branch out in a row under the screen it leaves', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      EXAMPLE,
      `import { NAVIGATE_EVENT } from "../canvas/bridge";
const push = (href: string) => window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: href }));
const Screen = ({ title, children }: { title: string; children?: React.ReactNode }) => <div style={{ padding: 16 }}><h2>{title}</h2>{children}</div>;
export const Example = () => <Screen title="Plans"><a href="/checkout">Continue</a></Screen>;
export const Checkout = () => (
  <Screen title="Checkout">
    <button type="button" onClick={() => push("/done")}>Pay</button> <a href="/failed">Card declined</a> <a href="/plans">Back</a>
  </Screen>
);
export const Done = () => <Screen title="Done" />;
export const Failed = () => <Screen title="Failed"><a href="/checkout">Try again</a></Screen>;
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Checkout, Done, Example, Failed } from "./items/Example";')
        // Listed in the order a person goes through them: the main path, then the branch.
        .replace('component: Example,', 'component: Example,\n    path: "/plans",\n    screens: { "/checkout": Checkout, "/done": Done, "/failed": Failed },'),
    )
    await expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('"/failed"'), { timeout: 15_000 }).toBe(true)
    await expect.poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('Failed'), { timeout: 15_000 }).toBe(true)
    await page.goto('/')
    await page.getByRole('button', { name: 'Show the 4 screens of Example · replace me' }).click()
    const view = page.getByRole('dialog', { name: 'Screens of Example · replace me' })
    const screen = (name: string) => view.locator('.canvas-flow-screen').filter({ has: page.getByRole('heading', { name, exact: true }) })
    // Before anyone pressed Pay, nothing is known to lead to Done; it stays on the main path all the same.
    await expect(screen('Done')).toHaveAttribute('data-row', '0')
    await expect(screen('Failed')).toHaveAttribute('data-row', '1')
    const checkoutBox = (await screen('Checkout').boundingBox())!
    const failedBox = (await screen('Failed').boundingBox())!
    expect(Math.abs(failedBox.x - checkoutBox.x)).toBeLessThan(2)
    expect(failedBox.y).toBeGreaterThan(checkoutBox.y + checkoutBox.height)
    // Down into the branch, and back up out of it, with their words.
    await expect(view.locator('.canvas-flow-arrows text')).toContainText(['click "Card declined"', 'click "Try again"'])
    await page.keyboard.press('Escape')
    // Once Pay is pressed, Done gets its arrow, and the layout is the same.
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    await item.getByRole('link', { name: 'Continue' }).click()
    await item.getByRole('button', { name: 'Pay' }).click()
    await page.getByRole('button', { name: 'Show the 4 screens of Example · replace me' }).click()
    await expect(view.locator('.canvas-flow-arrows text')).toContainText(['click "Pay"'])
    await expect(screen('Done')).toHaveAttribute('data-row', '0')
    await expect(screen('Failed')).toHaveAttribute('data-row', '1')
    expect(errors).toEqual([])
  } finally {
    writeFileSync(EXAMPLE, example)
    await restoreRegistry(page, original)
  }
})

test('a step the registry names has its arrow from the start, and the layout does not wait for a first try', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      EXAMPLE,
      `import { NAVIGATE_EVENT } from "../canvas/bridge";
const push = (href: string) => window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: href }));
const Screen = ({ title, children }: { title: string; children?: React.ReactNode }) => <div style={{ padding: 16 }}><h2>{title}</h2>{children}</div>;
export const Example = () => <Screen title="List"><a href="/upload">Upload</a> <a href="/review/1">First</a></Screen>;
export const Upload = () => <Screen title="Upload"><button type="button" onClick={() => push("/review/1")}>Start review</button></Screen>;
export const Review = () => <Screen title="Review"><a href="/done">Approve</a></Screen>;
export const Done = () => <Screen title="Done" />;
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Done, Example, Review, Upload } from "./items/Example";')
        // The router call in Upload is named, with one to a path the item does not show, which is left out.
        .replace(
          'component: Example,',
          'component: Example,\n    path: "/list",\n    screens: { "/upload": Upload, "/review/:id": Review, "/done": Done },\n    steps: { "/upload": { "Start review": "/review/1", Help: "/help" } },',
        ),
    )
    await expect.poll(async () => (await (await page.request.get('/registry.tsx')).text()).includes('Start review'), { timeout: 15_000 }).toBe(true)
    await expect.poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('Review'), { timeout: 15_000 }).toBe(true)
    await page.goto('/')
    await page.getByRole('button', { name: 'Show the 4 screens of Example · replace me' }).click()
    const view = page.getByRole('dialog', { name: 'Screens of Example · replace me' })
    // Nobody pressed Start review, and still: its arrow is there, and Review is on the main path,
    // not a branch of List (which links to it too).
    // Between two screens its words take two lines.
    await expect(view.locator('.canvas-flow-arrows > g').filter({ hasText: '"Start' }).filter({ hasText: 'review"' })).toHaveCount(1)
    await expect(view.locator('.canvas-flow-screen[data-row="1"]')).toHaveCount(0)
    await expect(view.locator('.canvas-flow-arrows > g').filter({ hasText: 'Help' })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    writeFileSync(EXAMPLE, example)
    await restoreRegistry(page, original)
  }
})

test('states belong to their screen: the flow view switches between them, and the canvas shows the first', async ({ page }) => {
  const original = readFileSync(REGISTRY, 'utf8')
  const example = readFileSync(EXAMPLE, 'utf8')
  try {
    const errors = collectErrors(page)
    writeFileSync(
      EXAMPLE,
      `const Screen = ({ title, children }: { title: string; children?: React.ReactNode }) => <div style={{ padding: 16 }}><h2>{title}</h2>{children}</div>;
export const Example = () => <Screen title="Plans"><a href="/checkout">Continue</a></Screen>;
export const Checkout = () => <Screen title="Checkout"><button type="button">Pay</button> <a href="/plans">Back</a></Screen>;
export const CheckoutEmpty = () => <Screen title="Checkout · nothing to pay" />;
export const CheckoutError = () => <Screen title="Checkout · card error"><button type="button">Retry</button></Screen>;
export const List = () => <Screen title="List" />;
export const ListEmpty = () => <Screen title="List · empty" />;
`,
    )
    writeFileSync(
      REGISTRY,
      original
        .replace('import { Example } from "./items/Example";', 'import { Checkout, CheckoutEmpty, CheckoutError, Example, List, ListEmpty } from "./items/Example";')
        .replace(
          'component: Example,',
          'component: Example,\n    path: "/plans",\n    screens: { "/checkout": Checkout },\n    states: { "/checkout": { Empty: CheckoutEmpty, "Card error": CheckoutError } },',
        )
        .replace(
          /\];\s*$/,
          `  { id: "list", name: "List", component: List, states: { "": { Empty: ListEmpty } }, x: 500, y: 0, width: 300, height: 160 },
];
`,
        ),
    )
    await servesId(page, 'list')
    await expect.poll(async () => (await (await page.request.get('/items/Example.tsx')).text()).includes('ListEmpty'), { timeout: 15_000 }).toBe(true)
    await page.goto('/')
    // The canvas shows each item in its first state; the button says what the item holds.
    const item = page.locator('.canvas-item[data-canvas-item="example"]')
    await expect(item.locator('h2')).toHaveText('Plans')
    await expect(page.getByRole('button', { name: 'Show the 2 screens and 2 states of Example · replace me' })).toBeVisible()
    // One screen with states opens too.
    await page.getByRole('button', { name: 'Show 1 state of List' }).click()
    const list = page.getByRole('dialog', { name: 'Screens of List' })
    await list.getByRole('combobox', { name: 'States of Start' }).selectOption('Empty')
    await expect(list.locator('.canvas-flow-screen h2')).toHaveText('List · empty')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Show the 2 screens and 2 states of Example · replace me' }).click()
    const view = page.getByRole('dialog', { name: 'Screens of Example · replace me' })
    const checkout = view.locator('.canvas-flow-screen').nth(1)
    const states = checkout.getByRole('combobox', { name: 'States of /checkout' })
    await expect(states.locator('option')).toHaveText(['Default', 'Empty', 'Card error'])
    await expect(states).toHaveValue('')
    const arrows = await view.locator('.canvas-flow-arrows > g').count()
    await states.selectOption('Card error')
    await expect(checkout.locator('h2')).toHaveText('Checkout · card error')
    // Another state moves nothing and takes no arrow away, but an arrow it has no control for is dimmed.
    await page.waitForTimeout(700)
    await expect(view.locator('.canvas-flow-arrows > g')).toHaveCount(arrows)
    const back = view.locator('.canvas-flow-arrows > g').filter({ hasText: 'click "Back"' })
    await expect(back).toHaveAttribute('data-absent', 'true')
    await states.selectOption('')
    await expect(back).not.toHaveAttribute('data-absent')
    await states.selectOption('Card error')
    // A note asked on a state names it.
    await checkout.hover()
    await checkout.getByRole('button', { name: 'Ask agent about /checkout' }).click()
    await expect(page.getByRole('dialog', { name: /Example · replace me › screen \/checkout \(Card error\)/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(view).toHaveCount(0)
    await expect(item.locator('h2')).toHaveText('Plans')
    expect(errors).toEqual([])
  } finally {
    writeFileSync(EXAMPLE, example)
    await restoreRegistry(page, original)
  }
})
