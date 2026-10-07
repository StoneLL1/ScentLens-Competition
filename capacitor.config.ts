import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.scentlens.app',
  appName: '闻见 ScentLens',
  webDir: 'dist',
  server: { hostname: 'localhost', iosScheme: 'capacitor' },
  ios: { contentInset: 'never', backgroundColor: '#FDFDFE' },
}
export default config
