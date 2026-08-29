import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSettings } from '@/services/settings'
import type { Settings } from '@/services/settings'
import InitWall from '@/features/settings/InitWall'
import { isInitialized } from '@/features/settings/utils/required'
import '@/styles/spinner.css'
import './InitGate.css'

type Phase = 'loading' | 'wall' | 'app'

// Decides between the first-run wall and the app itself. Until the store answers there is no
// sidebar and no route, so an unconfigured install cannot reach a screen that would only fail.
export default function InitGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('loading')
  const [stored, setStored] = useState<Settings | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const settings = await fetchSettings()
        setStored(settings)
        setPhase(isInitialized(settings) ? 'app' : 'wall')
      } catch {
        // A downed store is not an unconfigured install. Dropping a working app into onboarding
        // over a transient outage is worse than the connection toast the client already shows.
        setPhase('app')
      }
    }
    void load()
  }, [])

  if (phase === 'loading') {
    return (
      <div className="init-gate">
        <div className="spinner" />
      </div>
    )
  }

  if (phase === 'wall' && stored) {
    return (
      <InitWall
        stored={stored}
        onDone={() => {
          setPhase('app')
          navigate('/')
        }}
      />
    )
  }

  return <>{children}</>
}
