import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Lecture } from '@/types'
import { renameLecture } from '@/services/database'
import { toast } from '@/services/toaster'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { findLecture } from '@/features/lectures/utils/courseTree'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { usePendingUpload } from '@/features/lectures/sidebar/PendingUploadModal'
import { useCourseGroup } from './CourseGroupContext'
import { useLectureListKind } from './LectureListContext'
import '@/styles/sidebar-tree.css'

export default function LectureItem({ lecture }: { lecture: Lecture }) {
  const { t } = useLingui()
  const { course } = useCourseGroup()
  const kind = useLectureListKind()
  const { selected, onSelect } = useSelection()
  const { courses, refreshCourses } = useCourseTreeContext()
  const upload = usePendingUpload()

  const [renaming, setRenaming] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const renameEdit = useInlineEdit(renaming ? lecture.name : null)

  const isSelected =
    selected?.course === course.name &&
    selected?.lecture === lecture.name &&
    selected?.kind === kind

  function startRenaming(e: React.MouseEvent) {
    e.preventDefault()
    setRenaming(true)
    renameEdit.setValue(lecture.name)
  }

  async function commitRename() {
    const name = renameEdit.value.trim()
    setRenaming(false)
    renameEdit.setValue('')
    if (!name || name === lecture.name) return
    await renameLecture(course.name, lecture.name, name, kind)
    if (isSelected) onSelect(course.name, name, kind)
    refreshCourses()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
      toast('error', t`Only .mp4 files are allowed`)
      return
    }
    const found = findLecture(courses, course.name, lecture.name, kind)
    if (found?.files['video.mp4'].exists) {
      upload.confirm(course.name, lecture.name, file, kind)
    } else {
      upload.trigger(course.name, lecture.name, file, kind)
    }
  }

  if (renaming) {
    return (
      <li>
        <InlineEditInput
          edit={renameEdit}
          onCommit={commitRename}
          onCancel={() => {
            setRenaming(false)
            renameEdit.setValue('')
          }}
        />
      </li>
    )
  }

  return (
    <li>
      <button
        className={`lecture-btn${isSelected ? ' selected' : ''}${dragOver ? ' drag-over' : ''}`}
        onClick={(e) => {
          if (e.shiftKey) startRenaming(e)
          else onSelect(course.name, lecture.name, kind)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        dir="auto"
      >
        {lecture.name}
      </button>
    </li>
  )
}
