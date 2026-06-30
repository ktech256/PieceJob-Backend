import { Router } from 'express';
import * as marketingController from '../controllers/admin/marketing.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

// Admin Only
router.post('/promotions', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.createPromotion);
router.get('/promotions', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.listPromotions);
router.patch('/promotions/:id', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.updatePromotion);
router.delete('/promotions/:id', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.deletePromotion);

router.post('/notifications/push', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.sendCustomPush);

export default router;
