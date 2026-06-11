import { Router } from 'express';
import * as disputeController from '../controllers/dispute.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.post('/', authenticate, disputeController.raiseDispute);
router.get('/', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.SUPPORT_ADMIN]), disputeController.getDisputes);
router.patch('/:disputeId', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.SUPPORT_ADMIN]), disputeController.updateDisputeStatus);

export default router;
