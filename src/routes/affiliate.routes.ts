import { Router } from 'express';
import * as affiliateController from '../controllers/affiliate.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

// Partner Portal Routes
router.post('/login', affiliateController.loginPartner);
router.post('/forgot-password', affiliateController.forgotPartnerPassword);
router.post('/reset-password', affiliateController.resetPartnerPassword);
router.get('/dashboard', authenticate, affiliateController.getPartnerDashboard);
router.get('/statements', authenticate, affiliateController.getPartnerStatements);
router.get('/reports', authenticate, affiliateController.getPartnerReports);
router.get('/notifications', authenticate, affiliateController.getPartnerNotifications);
router.put('/profile', authenticate, affiliateController.updatePartnerProfile);
router.put('/banking', authenticate, affiliateController.updatePartnerBanking);
router.post('/settlements/request', authenticate, affiliateController.requestSettlement);
router.get('/settlements', authenticate, affiliateController.getPartnerSettlements);

// Admin Routes for Managing Partners
router.post('/admin', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.createPartner);
router.patch('/admin/:id', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.updatePartner);
router.get('/admin', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.getPartners);
router.get('/admin/:id/analytics', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.getPartnerAnalytics);

// Admin Settlement Management
router.get('/admin/settlements', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.adminGetSettlements);
router.patch('/admin/settlements/:id/status', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE_ADMIN]), affiliateController.adminUpdateSettlementStatus);

export default router;
