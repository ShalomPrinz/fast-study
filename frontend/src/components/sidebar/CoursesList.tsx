import { useMatch, useNavigate } from 'react-router-dom'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'
import { courseRoute } from '@/utils/url'

// Courses sidebar body: a flat list of all non-archived courses
export default function CoursesList() {
  const { courses } = useCourseTreeContext()
  const navigate = useNavigate()
  const selectedCourse = useMatch('/course/:course')?.params.course

  return (
    <nav className="sidebar-nav">
      <ul className="lecture-list course-list">
        {courses.filter((c) => !c.archived).map((course) => (
          <li key={course.name}>
            <button
              className={`lecture-btn${selectedCourse === course.name ? ' selected' : ''}`}
              onClick={() => navigate(courseRoute(course.name))}
            >
              {course.name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
