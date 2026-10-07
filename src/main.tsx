import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/noto-sans-sc'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/capture.css'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
