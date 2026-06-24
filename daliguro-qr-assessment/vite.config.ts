import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
// `host: true` exposes the server to other devices on the same Wi-Fi.
// HTTPS is OFF by default (so a plain `http://<ip>:5173` URL just works and
// the camera works on this Mac via http://localhost). Run `npm run dev:https`
// to enable a self-signed HTTPS cert — needed only for the camera scanner on a
// remote phone, since iOS Safari requires a secure context for getUserMedia.
const useHttps = process.env.HTTPS === 'true'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
    // Allow Cloudflare quick-tunnel hostnames (used to test the camera over
    // trusted HTTPS on a phone). Without this Vite rejects the proxied Host.
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: [".trycloudflare.com"],
  },
})
