import { Router } from 'express';
import { setReporting } from '@faststudy/sentry';
import { invalidRequest } from '../validate.js';

const router = Router();

// Apply launcher settings to the running process; omitted fields are left alone.
router.post('/config', (req, res) => {
  const body = req.body ?? {};
  const applied = [];
  if ('error_reports' in body) {
    if (typeof body.error_reports !== 'boolean') {
      return res
        .status(400)
        .json(invalidRequest('error_reports', 'error_reports must be a boolean'));
    }
    // Live: the gated transport and scrub read this flag on every send, so no re-init.
    setReporting(body.error_reports);
    applied.push('error_reports');
  }
  res.json({ status: 'ok', applied });
});

export default router;
