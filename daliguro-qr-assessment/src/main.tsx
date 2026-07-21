import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import { AppRoute, SmartScanMobileRoute } from './lazy-routes.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-slate-50 p-6 text-sm font-bold text-slate-500">Loading DALIguro…</div>}>
        <Routes>
          {/* Phone scanner deep link (paired from the PC). */}
          <Route path="/smartscan/mobile/:sessionId" element={<SmartScanMobileRoute />} />
          {/* Everything else is the desktop dashboard. */}
          <Route path="*" element={<AppRoute />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)

// Build stamp: identifies exactly which build a client is running. Field
// failures have been mis-attributed to scanner bugs when the phone was in
// fact running a stale cached build, so this is logged and shown in the UI.
console.info('[daliguro] build', __BUILD_ID__)

// Register the offline service worker in production builds only. In dev we skip
// it so Vite HMR is never served stale assets from the cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // The SW calls skipWaiting()+clients.claim(), so an updated worker takes
  // control as soon as it installs. Reload once at that moment so long-lived
  // tabs (phones left open on the scanner page) converge to the new build
  // instead of running old JS against new expectations.
  let reloadedForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate || !navigator.serviceWorker.controller) return
    reloadedForUpdate = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Long-lived phone tabs never renavigate, so the browser never
        // re-checks sw.js on its own. Check on every return to the tab.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration.update()
        })
      })
      .catch(() => {
        // Offline launch is a progressive enhancement — ignore registration errors.
      })
  })
}
