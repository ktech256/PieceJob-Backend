import { Router } from 'express';
import * as providerController from '../controllers/provider.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.get('/profile', authenticate, authorize([UserRole.PROVIDER]), providerController.getProviderProfile);
router.patch('/status', authenticate, authorize([UserRole.PROVIDER]), providerController.updateStatus);
router.post('/documents', authenticate, authorize([UserRole.PROVIDER]), providerController.uploadDocument);

export default router;
