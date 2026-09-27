/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { lingui } from '@lingui/vite-plugin'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { fileURLToPath } from 'node:url'

// Source maps go to Sentry only from a `vite build` holding `SENTRY_AUTH_TOKEN`; every other build
// emits none and loads no plugin. The release is the installer's, which CI computes past
// electron/package.json's patch, so it comes from `FASTSTUDY_VERSION` — see docs/SERVICES.md.
function sentryUpload(): PluginOption[] {
  const authToken = process.env.SENTRY_AUTH_TOKEN
  if (!authToken) return []
  const version = process.env.FASTSTUDY_VERSION
  if (!version) throw new Error('SENTRY_AUTH_TOKEN is set but FASTSTUDY_VERSION is not')
  return [
    sentryVitePlugin({
      authToken,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT || 'faststudy',
      release: { name: `faststudy@${version}` },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      telemetry: false,
    }),
  ]
}

export default defineConfig(({ command }) => {
  const upload = command === 'build' ? sentryUpload() : []
  return {
    // Vitest shares this config, so the macro transform reaches tests too — without it they would
    // see raw, unexpanded Lingui macros.
    plugins: [
      react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
      lingui(),
      ...upload,
    ],
    // Hidden: the maps exist only for the upload, which deletes them, and no bundle points at one.
    build: { sourcemap: upload.length ? 'hidden' : false },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      setupFiles: ['./src/test-setup.ts'],
    },
  }
})
