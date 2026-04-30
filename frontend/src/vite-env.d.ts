/// <reference types="vite/client" />

declare module 'virtual:tree' {
  import type { Course } from './api'
  export const tree: Course[]
}
