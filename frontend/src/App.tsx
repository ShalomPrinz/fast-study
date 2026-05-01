import { useState, useEffect, useMemo } from 'react'
import { ToastContainer } from 'react-toastify'
import { fetchTree, fetchCourse, runStep, deleteFile, fetchTimingStats, Step, FileName, FileStatus, TimingStats, Lecture, Course } from './api'
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
  startedAt?: number
  timingStats?: TimingStats | null
}

export interface RunAllState {
  steps: Step[]
  currentIndex: number
}

const STEP_INPUT_FILE: Partial<Record<Step, FileName>> = {
  audio: 'video.mp4',
  transcribe: 'audio.mp3',
  summarize: 'transcript.txt',
  pdf: 'summary.md',
}

const PIPELINE_STEPS: Array<{ file: FileName; step: Step }> = [
  { file: 'audio.mp3',      step: 'audio'     },
  { file: 'transcript.txt', step: 'transcribe' },
  { file: 'summary.md',     step: 'summarize'  },
  { file: 'summary.pdf',    step: 'pdf'        },
]

export default function App() {
  const [courses, setCourses] = useState<Course[]>([])
  const [sortedCourses, setSortedCourses] = useState<Course[]>([])
  const [selected, setSelected] = useState<Selected | null>(null)
  const [reqState, setReqState] = useState<ReqState | null>(null)
  const [runAllState, setRunAllState] = useState<RunAllState | null>(null)

  useEffect(() => {
    fetchTree().then(setCourses)
  }, [])

  useEffect(() => {
    setSortedCourses(
      courses.map((c) => ({
        ...c,
        lectures: [...c.lectures].sort((a, b) => a.name.localeCompare(b.name)),
      }))
    )
  }, [courses])

  const files = useMemo<FileStatus | null>(() => {
    if (!selected) return null
    const course = courses.find((c) => c.name === selected.course)
    const lecture = course?.lectures.find((l: Lecture) => l.name === selected.lecture)
    return lecture?.files ?? null
  }, [courses, selected])

  function handleCourseClick(courseName: string) {
    fetchCourse(courseName).then((updated) => {
      if (!updated) return
      setCourses((prev) => prev.map((c) => (c.name === courseName ? updated : c)))
    })
  }

  function handleSelect(course: string, lecture: string) {
    setSelected({ course, lecture })
    setReqState(null)
    setRunAllState(null)
  }

  async function executeStep(step: Step, currentFiles: FileStatus | null): Promise<boolean> {
    if (!selected) return false
    const startedAt = Date.now()
    const inputFile = STEP_INPUT_FILE[step]
    const fileSizeBytes = inputFile ? (currentFiles?.[inputFile]?.size ?? 0) : 0

    setReqState({ step, status: 'inflight', startedAt, timingStats: null })
    if (fileSizeBytes > 0) {
      fetchTimingStats(step, fileSizeBytes).then((stats) =>
        setReqState((prev) =>
          prev?.status === 'inflight' && prev.step === step ? { ...prev, timingStats: stats } : prev
        )
      )
    }

    const result = await runStep(selected.course, selected.lecture, step)
    if (result.status === 'done') {
      setReqState(null)
      fetchTree().then(setCourses)
      return true
    } else {
      setReqState({ step, status: 'error', message: result.message })
      return false
    }
  }

  async function handleRun(step: Step) {
    if (!selected) return
    await executeStep(step, files)
  }

  async function handleRotate(step: Step, filesToDelete: FileName[]) {
    if (!selected) return
    await Promise.all(filesToDelete.map((file) => deleteFile(selected.course, selected.lecture, file)))
    const updated = await fetchTree()
    setCourses(updated)
    await handleRun(step)
  }

  async function handleRunRemaining() {
    if (!selected || !files) return

    const remainingSteps = PIPELINE_STEPS
      .filter(({ file }) => !files[file].exists)
      .map(({ step }) => step)

    if (remainingSteps.length === 0) return

    setRunAllState({ steps: remainingSteps, currentIndex: 0 })

    for (let i = 0; i < remainingSteps.length; i++) {
      setRunAllState((prev) => prev ? { ...prev, currentIndex: i } : null)
      const success = await executeStep(remainingSteps[i], files)
      if (!success) break
    }

    setRunAllState(null)
  }

  return (
    <div className="layout">
      <Sidebar
        courses={sortedCourses}
        selected={selected}
        onSelect={handleSelect}
        onCourseClick={handleCourseClick}
      />
      <MainView
        selected={selected}
        files={files}
        reqState={reqState}
        runAllState={runAllState}
        onRun={handleRun}
        onRunRemaining={handleRunRemaining}
        onRotate={handleRotate}
        inflight={reqState?.status === 'inflight'}
      />
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  )
}
