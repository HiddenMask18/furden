import { defineConfig } from 'vitest/config'

// Standalone test config — no router/react plugins, so pure-module tests (envelope, crypto
// framing) run without generating the route tree or a browser environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
