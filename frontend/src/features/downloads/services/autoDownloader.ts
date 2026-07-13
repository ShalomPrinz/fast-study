import { createClient } from '@/services/http'

// Boundary for the auto-downloader service (persistent-browser BIU capture).
const autoDownloader = createClient(
  import.meta.env.VITE_AUTODL_URL ?? 'http://localhost:3053',
  'auto-downloader service',
)

export interface AuthStatus {
  connected: boolean
  expired: boolean
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return autoDownloader.get<AuthStatus>('/auth/status')
}

// Launches a headed browser on the machine for MFA; returns immediately.
export async function connectAuth(): Promise<{ status: string }> {
  return autoDownloader.post<{ status: string }>('/auth/connect')
}

// Persists the storageState and closes the headed browser once the user finishes login.
export async function completeAuth(): Promise<{ connected: boolean }> {
  return autoDownloader.post<{ connected: boolean }>('/auth/complete')
}
