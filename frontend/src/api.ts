const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface Course {
  name: string
  lectures: string[]
}

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf' | 'all'

export interface StepResult {
  status: 'done' | 'error'
  message?: string
}

export async function runStep(course: string, lecture: string, step: Step): Promise<StepResult> {
  const res = await fetch(
    `${API_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/run/${step}`,
    { method: 'POST' },
  )
  return res.json()
}
