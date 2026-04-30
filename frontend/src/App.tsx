import { useState, useEffect } from 'react'
import { tree } from 'virtual:tree'
import { runStep, Step, FileStatus, FileName, Lecture } from './api'
import Sidebar from './components/Sidebar'
import MainView from './components/MainView'

export interface Selected {
  course: string
  lecture: string
}

export interface ReqState {
  step: Step
  status: 'inflight' | 'error'
  message?: string
}

const STEP_PRODUCES: Partial<Record<Step, FileName[]>> = {
  audio: ['audio.mp3'],
  transcribe: ['transcript.txt'],
  summarize: ['summary.md'],
  pdf: ['summary.pdf'],
  all: ['audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf'],
}

export default function App() {
  const [selected, setSelected] = useState<Selected | null>(null)
  const [reqState, setReqState] = useState<ReqState | null>(null)
  const [files, setFiles] = useState<FileStatus | null>(null)

  useEffect(() => {
    if (!selected) { setFiles(null); return }
    const course = tree.find((c) => c.name === selected.course)
    const lecture = course?.lectures.find((l: Lecture) => l.name === selected.lecture)
    setFiles(lecture?.files ?? null)
  }, [selected])

  function handleSelect(course: string, lecture: string) {
    setSelected({ course, lecture })
    setReqState(null)
  }

  async function handleRun(step: Step) {
    if (!selected) return
    setReqState({ step, status: 'inflight' })
    const result = await runStep(selected.course, selected.lecture, step)
    if (result.status === 'done') {
      setReqState(null)
      const produced = STEP_PRODUCES[step]
      if (produced) {
        setFiles((prev) => {
          if (!prev) return prev
          const next = { ...prev }
          produced.forEach((f) => { next[f] = true })
          return next
        })
      }
    } else {
      setReqState({ step, status: 'error', message: result.message })
    }
  }

  return (
    <div className="layout">
      <Sidebar
        courses={tree}
        selected={selected}
        onSelect={handleSelect}
      />
      <MainView
        selected={selected}
        files={files}
        reqState={reqState}
        onRun={handleRun}
        inflight={reqState?.status === 'inflight'}
      />
    </div>
  )
}
