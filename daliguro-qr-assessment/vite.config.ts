import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
// `host: true` exposes the server to other devices on the same Wi-Fi.
// HTTPS is OFF by default (so a plain `http://<ip>:5173` URL just works and
// the camera works on this Mac via http://localhost). Run `npm run dev:https`
// to enable HTTPS — needed only for the camera scanner on a remote phone,
// since iOS Safari requires a secure context for getUserMedia.
//
// Certificate preference: a trusted mkcert certificate in certs/ (generate with
// `mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 127.0.0.1 <lan-ip>`
// after `mkcert -install`, so browsers show no warning). Falls back to
// plugin-basic-ssl's self-signed cert when certs/ is absent.
const useHttps = process.env.HTTPS === 'true'
const mkcertKey = new URL('./certs/dev-key.pem', import.meta.url)
const mkcertCert = new URL('./certs/dev-cert.pem', import.meta.url)
const hasMkcert = existsSync(mkcertKey) && existsSync(mkcertCert)
const httpsConfig = useHttps && hasMkcert
  ? { key: readFileSync(mkcertKey), cert: readFileSync(mkcertCert) }
  : undefined

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(useHttps && !hasMkcert ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
    https: httpsConfig,
    // Allow Cloudflare quick-tunnel hostnames (used to test the camera over
    // trusted HTTPS on a phone). Without this Vite rejects the proxied Host.
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    host: true,
    port: 4173,
    https: httpsConfig,
    allowedHosts: [".trycloudflare.com"],
  },
})
