import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]));

router.get('/verifications/pending', adminController.getPendingVerifications);
router.patch('/verifications/:providerId', adminController.verifyProvider);
router.get('/finance/overview', adminController.getFinancialOverview);

export default router;
