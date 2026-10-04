# extension/

## Status

Unused and unmaintained; `auto/` covers the same sources for users. A change elsewhere that breaks the extension is recorded under Known issues here, not fixed.

## Known issues

- **A download into a new course fails.** The database's `PUT …/video` and `POST …/materials` answer 404 `course_not_found` for a missing course, so a download finishing after a rename can't recreate the old one; the popup's free-text course field (`regular/popup.html:84`) still lets a new name through.
  Fix: create the course before the job starts (the server's `/download`, `/download-youtube` and `/upload-pdf` call the database's create-course route when it's missing), or restrict the field to existing courses.
