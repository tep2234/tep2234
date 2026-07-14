import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep Playwright's real-browser specs under its own runner. Allowing
    // Vitest to import them makes Playwright hooks execute without a browser
    // test context and breaks the otherwise independent unit-test gate.
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/lib/test-setup.ts"],
    // Tests always run in the offline/unconfigured baseline, so a developer's
    // local .env.local (real Supabase keys for live verification) can't
    // contaminate the "disabled mode" suite. Configured-mode behaviour is
    // covered by mocking, not ambient env.
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
  },
});
