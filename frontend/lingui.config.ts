import { defineConfig } from '@lingui/cli'

export default defineConfig({
  locales: ['he', 'en'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src'],
    },
  ],
})
