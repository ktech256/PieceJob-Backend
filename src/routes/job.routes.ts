import { Router } from 'express';
import * as jobController from '../controllers/job.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.post('/request', authenticate, authorize([UserRole.CUSTOMER]), jobController.requestJob);
router.post('/:jobId/pay', authenticate, authorize([UserRole.CUSTOMER]), jobController.payBookingFee);
router.put('/:jobId/accept', authenticate, authorize([UserRole.PROVIDER]), jobController.acceptJob);
router.patch('/:jobId/status', authenticate, jobController.updateJobStatus);

export default router;
