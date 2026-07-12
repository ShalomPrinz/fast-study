import { useState } from 'react'
import type { ExpandHandle } from '@/types'
import { renameCourse, setCourseArchived } from '@/services/database'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { useShiftHeld } from '@/features/lectures/hooks/useShiftHeld'
import { useInlineEdit } from '@/features/lectures/hooks/useInlineEdit'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import Icon from '@/shared/components/Icon'
import InlineEditInput from '@/features/lectures/components/InlineEditInput'
import { useCourseGroup } from './CourseGroupContext'

// Course header both reflects expand state and mutates it - toggle on click, open when adding a lecture
export default function CourseHeader({ expand }: { expand: ExpandHandle }) {
  const { course, add } = useCourseGroup()
  const { selected, onSelect } = useSelection()
  const { refreshCourses } = useCourseTreeContext()
  const shiftHeld = useShiftHeld()

  const [renaming, setRenaming] = useState(false)
  const renameEdit = useInlineEdit(renaming ? course.name : null)

  function startRenaming(e: React.MouseEvent) {
    e.preventDefault()
    setRenaming(true)
    renameEdit.setValue(course.name)
  }

  async function commitRename() {
    const name = renameEdit.value.trim()
    setRenaming(false)
    renameEdit.setValue('')
    if (!name || name === course.name) return
    await renameCourse(course.name, name)
    if (selected?.course === course.name) {
      onSelect(name, selected.lecture, selected.kind)
    }
    refreshCourses()
  }

  function startAdding(e: React.MouseEvent) {
    e.stopPropagation()
    expand.open()
    add.start('lecture')
  }

  async function toggleArchived(e: React.MouseEvent) {
    e.stopPropagation()
    await setCourseArchived(course.name, !course.archived)
    refreshCourses()
  }

  return (
    <div className="course-header">
      {renaming ? (
        <InlineEditInput
          edit={renameEdit}
          onCommit={commitRename}
          onCancel={() => { setRenaming(false); renameEdit.setValue('') }}
        />
      ) : (
      <button
        className="course-toggle"
        onClick={(e) => {
          if (e.shiftKey) startRenaming(e)
          else expand.toggle()
        }}
        dir="auto"
      >
        <span className="chevron">{expand.isOpen ? '▾' : '▸'}</span>
        <span>{course.name}</span>
      </button>
      )}
      {!renaming && (
        shiftHeld ? (
          <button
            className="course-add-btn course-archive-btn"
            onClick={toggleArchived}
            title={course.archived ? 'Unarchive course' : 'Archive course'}
          >
            <Icon icon={course.archived ? 'unarchive' : 'archive'} />
          </button>
        ) : (
          <button
            className="course-add-btn"
            onClick={startAdding}
            title="Add lecture"
          >
            +
          </button>
        )
      )}
    </div>
  )
}
