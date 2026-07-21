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

router.get('/referrals', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.listReferralCampaigns);
router.post('/referrals', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.createReferralCampaign);
router.patch('/referrals/:id', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.updateReferralCampaign);
router.delete('/referrals/:id', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.deleteReferralCampaign);
router.get('/referrals/analytics', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.getReferralAnalytics);
router.post('/referrals/toggle-privileges', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.toggleReferralPrivileges);

router.get('/affiliate/settings', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.getAffiliateSettings);
router.patch('/affiliate/settings', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.updateAffiliateSettings);

router.post('/notifications/push', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), marketingController.sendCustomPush);

export default router;
