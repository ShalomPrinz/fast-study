import { useState } from 'react'
import { tree } from 'virtual:tree'
import { runStep, Step } from './api'
import Sidebar from './components/Sidebar'
import MainView from './components/MainView'

export interface Selected {
  course: string
  lecture: string
}

export interface ReqState {
  step: Step
  status: 'inflight' | 'done' | 'error'
  message?: string
}

export default function App() {
  const [selected, setSelected] = useState<Selected | null>(null)
  const [reqState, setReqState] = useState<ReqState | null>(null)

  function handleSelect(course: string, lecture: string) {
    setSelected({ course, lecture })
    setReqState(null)
  }

  async function handleRun(step: Step) {
    if (!selected) return
    setReqState({ step, status: 'inflight' })
    const result = await runStep(selected.course, selected.lecture, step)
    setReqState({
      step,
      status: result.status,
      message: result.message,
    })
  }

  return (
    <div className="layout">
      <Sidebar
        courses={tree}
        selected={selected}
        onSelect={handleSelect}
        onRun={handleRun}
        inflight={reqState?.status === 'inflight'}
      />
      <MainView selected={selected} reqState={reqState} />
    </div>
  )
}
