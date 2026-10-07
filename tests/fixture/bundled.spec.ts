import { test, expect, type Page } from '@playwright/test'

async function start(page: Page) {
  await page.goto('/trial')
  await expect(page.getByText('本次使用模拟八维，文字与作品为开发演示；不会连接设备或调用云端模型。')).toBeVisible()
  await expect(page.getByRole('button', { name: '输入演示访问码' })).toHaveCount(0)
  await expect(page.getByText('开发模拟选项')).toHaveCount(0)
  expect(await page.evaluate(() => '__task02' in window)).toBe(false)
  await page.getByRole('button', { name: '已移走样品，准备好了' }).click()
  await page.getByRole('button', { name: '开始读取', exact: true }).click()
  await page.waitForURL('**/result/*')
}

test('bundled fixture saves, archives, and reloads without model calls or test controls', async ({ page }, info) => {
  const apiCalls: string[] = [], errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort() })
  await start(page)
  const resultUrl = page.url()
  // Archive while generation is still pending; it must not start a new attempt.
  await page.getByRole('button', { name: '收藏到香廊', exact: true }).click()
  await page.getByLabel('香水名称（必填）').fill('Mac 原生验收样本')
  await page.getByRole('button', { name: '创建并收藏' }).click()
  await expect(page.getByText('固定测试作品 · 已保存本机，可离线回看', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: info.outputPath('fixture-result.png'), fullPage: true })
  await page.getByRole('button', { name: '图像版本', exact: true }).click()
  await expect(page.getByText('还没有可用的云端作品版本。预置展示与固定测试作品不计入版本。')).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '已收藏 · Mac 原生验收样本' }).click()
  await expect(page.getByText('等待首幅云端作品作为封面')).toBeVisible()
  await page.goto(resultUrl)
  await page.getByRole('button', { name: /上滑查看八维/ }).click()
  await expect(page.locator('.dimension-row')).toHaveCount(8)
  // Load the bundled-equivalent shell first, then block all HTTP. WebKit's
  // setOffline also blocks local blobs; the separate probe records that limit.
  await page.route(/^https?:/, route => route.abort())
  await page.getByRole('button', { name: '返回识别结果' }).click()
  await expect(page.locator('.artwork-window img')).toHaveJSProperty('naturalWidth', 292)
  expect(apiCalls).toEqual([]); expect(errors).toEqual([])
})

test('background interruption preserves eight dimensions and never resumes automatically', async ({ page }) => {
  const apiCalls: string[] = []
  await page.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort() })
  await start(page)
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await expect(page.locator('html')).toHaveAttribute('data-app-hidden', '')
  await expect(page.getByRole('button', { name: '继续开发演示' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  await expect(page.locator('html')).not.toHaveAttribute('data-app-hidden')
  await page.reload()
  await expect(page.getByRole('button', { name: '继续开发演示' })).toBeVisible()
  await expect(page.locator('.artwork-window img')).toHaveCount(0)
  await page.getByRole('button', { name: /上滑查看八维/ }).click()
  await expect(page.locator('.dimension-row')).toHaveCount(8)
  expect(apiCalls).toEqual([])
})

test('separate browser processes retain the fixture and its exact original bytes', async ({ browser }, info) => {
  const browserType = browser.browserType()
  const profile = info.outputPath('restart-profile')
  let context = await browserType.launchPersistentContext(profile, { viewport: { width: 402, height: 874 } })
  const calls: string[] = []
  const blockCloud = () => context.route('**/api/**', route => { calls.push(route.request().url()); return route.abort() })
  try {
    await blockCloud()
    let page = await context.newPage()
    await page.goto('http://127.0.0.1:4173/trial')
    await page.getByRole('button', { name: '已移走样品，准备好了' }).click()
    await page.getByRole('button', { name: '开始读取', exact: true }).click()
    await page.waitForURL('**/result/*')
    await expect(page.getByText('固定测试作品 · 已保存本机，可离线回看', { exact: true })).toBeVisible({ timeout: 15_000 })
    const resultUrl = page.url()
    const hash = (page: Page) => page.locator('.artwork-window img').evaluate(async image => {
      const bytes = await (await fetch((image as HTMLImageElement).src)).arrayBuffer()
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('')
    })
    const original = await hash(page)
    await context.close()
    context = await browserType.launchPersistentContext(profile, { viewport: { width: 402, height: 874 } })
    await blockCloud(); page = await context.newPage()
    await page.goto(resultUrl)
    await expect(page.locator('.artwork-window img')).toHaveJSProperty('naturalWidth', 292)
    expect(await hash(page)).toBe(original)
    expect(calls).toEqual([])
  } finally { await context.close() }
})
