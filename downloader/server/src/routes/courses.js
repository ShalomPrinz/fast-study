import { Router } from 'express';
import { listCourses, getCourseStructure } from '../services/database.js';

const router = Router();

router.get('/courses', async (req, res) => {
  res.json(await listCourses());
});

router.get('/course-structure', async (req, res) => {
  res.json(await getCourseStructure());
});

export default router;
