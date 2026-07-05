import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/lib/test-setup.ts"],
    // Tests always run in the offline/unconfigured baseline, so a developer's
    // local .env.local (real Supabase keys for live verification) can't
    // contaminate the "disabled mode" suite. Configured-mode behaviour is
    // covered by mocking, not ambient env.
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
  },
});
