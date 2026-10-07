import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Vercel injects this telemetry variable even with automatic system exposure
  // disabled. This App does not use it; remove it before Vite collects public env.
  delete process.env.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG
  const publicEnv = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const unexpected = Object.keys(publicEnv).filter(
    (key) => key.startsWith('VITE_') && key !== 'VITE_API_BASE_URL',
  )
  if (unexpected.length) {
    throw new Error(`Only VITE_API_BASE_URL may be exposed to the App. Unexpected variable names: ${unexpected.join(', ')}. Keep all credentials server-side.`)
  }
  return {
    envPrefix: 'VITE_API_BASE_URL',
    ...(mode === 'cloud' || mode === 'native-fixture' || mode === 'ble-validation' ? { define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(mode === 'cloud' ? 'http://127.0.0.1:8787' : '') } } : {}),
    plugins: [react(), tailwindcss()],
    optimizeDeps: { entries: ['index.html'] },
    server: {
      port: 5173,
      strictPort: true,
      watch: { ignored: ['**/ios/**'] },
    },
  }
})
