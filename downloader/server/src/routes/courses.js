import { Router } from 'express';
import { listCourses } from '../services/database.js';

const router = Router();

router.get('/courses', async (req, res) => {
  res.json(await listCourses());
});

export default router;
