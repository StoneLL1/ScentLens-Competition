import { test, expect } from '@playwright/test'

test('first visit, skip connection, four tabs, history, reload and return', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: '开始探索' }).click()
  await expect(page).toHaveURL(/\/connect$/)
  await expect(page.getByRole('button', { name: '搜索 Pocket', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '先逛逛' }).click()
  await expect(page.getByText('还没有留下气味记忆')).toBeVisible()
  await page.getByRole('link', { name: '开始试香', exact: true }).click()
  await expect(page).toHaveURL(/\/trial$/)
  await expect(page.getByRole('heading', { name: '准备一次试香' })).toBeVisible()
  for (const label of ['香廊', '我的', '首页']) {
    const link = page.getByRole('navigation').getByRole('link', { name: label, exact: true })
    await link.click()
    await expect(link).toHaveAttribute('aria-current', 'page')
  }
  await page.getByRole('link', { name: '查看全部识别记录' }).click()
  await expect(page).toHaveURL(/\/history$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: '识别记录', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.goto('/launch')
  await page.getByRole('button', { name: '开始探索' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/missing')
  await page.getByRole('link', { name: '返回首页', exact: true }).last().click()
  await expect(page).toHaveURL(/\/home$/)
  expect(errors).toEqual([])
})

for (const [width, height] of [[375, 667], [375, 812], [402, 874], [430, 932]]) {
  test(`entry and navigation reachable at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/launch')
    await page.getByRole('button', { name: '开始探索' }).click()
    await page.getByRole('link', { name: '先逛逛' }).click()
    const nav = page.getByRole('navigation')
    await expect(nav).toBeInViewport()
    await expect(page.getByRole('link', { name: '开始试香', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('link', { name: '开始试香', exact: true }).click()
    await expect(page.getByRole('heading', { name: '准备一次试香' })).toBeVisible()
  })
}

test('200% type, safe areas and reduced motion preserve accessible actions', async ({ page }) => {
  await page.goto('/home')
  await page.addStyleTag({ content: ':root{font-size:32px;--safe-top:62px;--safe-bottom:34px}' })
  expect(await page.locator('.hero-description').evaluate(el => {
    const style = getComputedStyle(el)
    return Number.parseFloat(style.lineHeight) >= Number.parseFloat(style.fontSize)
  })).toBe(true)
  await page.getByRole('link', { name: '开始试香', exact: true }).click()
  await expect(page).toHaveURL(/\/trial$/)
  await page.getByRole('navigation').getByRole('link', { name: '首页', exact: true }).click()
  await expect(page.getByText('还没有留下气味记忆')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/launch')
  expect(await page.locator('.launch-background').evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none')
})

test('production shell uses bundled assets without third-party requests', async ({ page }) => {
  const failures: string[] = []
  await page.route('**/*', route => {
    if (!route.request().url().startsWith('http://127.0.0.1:4173/')) {
      failures.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  await page.goto('/launch')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByRole('button', { name: '开始探索' })).toBeVisible()
  await page.goto('/home')
  await expect(page.getByRole('link', { name: '开始试香', exact: true })).toBeVisible()
  expect(failures).toEqual([])
})
