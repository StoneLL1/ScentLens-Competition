import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({ ...base, testDir: './tests/fixture', timeout: 45_000 })
