import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const action = process.argv[2]
const fixture = action === 'fixture'
const ble = action === 'ble'
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options })
const execute = (command, args, options = {}) => {
  const result = run(command, args, { stdio: 'inherit', ...options })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function xcodeEnvironment() {
  // Prefer the explicitly selected Xcode; use /Applications only when the
  // global selection still points at CommandLineTools. Never change it via sudo.
  const configured = process.env.DEVELOPER_DIR || run('xcode-select', ['-p']).stdout?.trim()
  const selected = configured?.endsWith('.app') ? resolve(configured, 'Contents/Developer') : configured
  const candidate = selected?.endsWith('/CommandLineTools') ? '/Applications/Xcode.app/Contents/Developer' : selected
  return candidate && existsSync(resolve(candidate, 'usr/bin/xcodebuild')) ? { ...process.env, DEVELOPER_DIR: candidate } : undefined
}

function doctor() {
  console.log(`Node ${process.version}; ${process.platform}/${process.arch}`)
  if (process.platform !== 'darwin') { console.error('iOS 编译需要 Mac；Web 构建和原生资源同步仍可独立运行。'); return }
  const env = xcodeEnvironment()
  if (!env) {
    console.error('未找到完整 Xcode。请安装 Xcode 26+，首次打开完成组件安装，再下载 iOS 平台。Command Line Tools 不能编译 iOS App。')
    return
  }
  const version = run('xcodebuild', ['-version'], { env })
  console.log(version.stdout || version.stderr)
  if (version.status !== 0 || Number(/Xcode (\d+)/.exec(version.stdout)?.[1] ?? 0) < 26) return
  const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { env })
  if (sdk.status !== 0) { console.error('iOS Simulator SDK 不可用，请在 Xcode Settings → Components 安装 iOS。'); return }
  const runtimes = run('xcrun', ['simctl', 'list', 'runtimes', '-j'], { env })
  if (runtimes.status !== 0) { console.error(runtimes.stderr); return }
  const available = JSON.parse(runtimes.stdout).runtimes.filter(r => r.isAvailable && r.identifier.includes('.iOS-'))
  console.log(`iOS SDK: ${sdk.stdout.trim()}`)
  console.log(`可用 iOS 模拟器运行时: ${available.map(r => r.name).join(', ') || '无（可编译，运行前需下载）'}`)
  console.log('签名与真机信任需在 Xcode 中选择 Team 并连接 iPhone；此检查不代表真机验收通过。')
  return env
}

if (action === 'doctor') {
  if (!doctor()) process.exitCode = 1
} else if (action === 'sync' || fixture || ble) {
  if (!fixture && !ble) {
    const env = loadEnv('production', process.cwd(), 'VITE_')
    const base = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL
    let url
    try { url = new URL(base) } catch { /* message below */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      console.error('iOS 云端构建需要公开的 HTTPS API 地址。将 .env.example 复制为 .env.production.local，或设置 VITE_API_BASE_URL；固定作品离线验收请运行 npm run ios:sync:fixture。')
      process.exit(1)
    }
  }
  execute(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'])
  execute(process.execPath, ['scripts/tokens.mjs', '--check'])
  execute(process.execPath, ['scripts/check-assets.mjs'])
  execute(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', fixture ? 'native-fixture' : ble ? 'ble-validation' : 'production'])
  execute(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'ios'])
  console.log(ble ? '已同步真实 BLE 验收包：原生 Pocket 输入与本地八维保存，不调用云端、不生成固定作品。' : fixture ? '已同步固定作品测试包：模拟八维与文字，本地固定图片，无云端调用。未执行 Swift 编译/安装。' : '已同步云端包：iPhone 使用原生 Pocket BLE；浏览器保留明确模拟输入。未执行 Swift 编译/安装。')
} else if (action === 'simulator') {
  const env = doctor()
  if (!env) process.exit(1)
  if (!existsSync('ios/App/App/public/index.html')) { console.error('请先运行 ios:sync 或 ios:sync:fixture。'); process.exit(1) }
  execute('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'ios/DerivedData', 'CODE_SIGNING_ALLOWED=NO', 'build'], { env })
} else {
  console.error('Usage: node scripts/ios.mjs doctor|sync|fixture|ble|simulator')
  process.exitCode = 1
}
