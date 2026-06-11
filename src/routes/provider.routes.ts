import { Router } from 'express';
import * as providerController from '../controllers/provider.controller';
import * as verificationController from '../controllers/provider/verification.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.get('/profile', authenticate, authorize([UserRole.PROVIDER]), providerController.getProviderProfile);
router.get('/dashboard-stats', authenticate, authorize([UserRole.PROVIDER]), providerController.getDashboardStats);
router.get('/verification/status', authenticate, authorize([UserRole.PROVIDER]), verificationController.getMyStatus);
router.post('/verification/submit', authenticate, authorize([UserRole.PROVIDER]), verificationController.submitMyVerification);
router.patch('/status', authenticate, authorize([UserRole.PROVIDER]), providerController.updateStatus);
router.post('/heartbeat', authenticate, authorize([UserRole.PROVIDER]), providerController.handleHeartbeat);
router.post('/documents', authenticate, authorize([UserRole.PROVIDER]), providerController.uploadDocument);

export default router;
