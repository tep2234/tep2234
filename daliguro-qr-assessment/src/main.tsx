import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import SmartScanMobilePage from './pages/SmartScanMobilePage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Phone scanner deep link (paired from the PC). */}
        <Route path="/smartscan/mobile/:sessionId" element={<SmartScanMobilePage />} />
        {/* Everything else is the desktop dashboard. */}
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

// Register the offline service worker in production builds only. In dev we skip
// it so Vite HMR is never served stale assets from the cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline launch is a progressive enhancement — ignore registration errors.
    })
  })
}
