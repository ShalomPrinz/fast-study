/// <reference types="node" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fsPlugin } from './fs-api'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), fsPlugin(env.VITE_DATA_ROOT)],
  }
})
