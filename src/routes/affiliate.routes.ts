import { Router } from 'express';
import * as affiliateController from '../controllers/affiliate.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

// Partner Portal Routes
router.post('/login', affiliateController.loginPartner);
router.get('/dashboard', authenticate, affiliateController.getPartnerDashboard);
router.get('/statements', authenticate, affiliateController.getPartnerStatements);
router.get('/reports', authenticate, affiliateController.getPartnerReports);
router.get('/notifications', authenticate, affiliateController.getPartnerNotifications);
router.put('/profile', authenticate, affiliateController.updatePartnerProfile);

// Admin Routes for Managing Partners
router.post('/admin', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.createPartner);
router.get('/admin', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.getPartners);
router.get('/admin/:id/analytics', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.getPartnerAnalytics);

export default router;
