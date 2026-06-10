import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import * as settingsController from '../controllers/admin/settings.controller';
import * as analyticsController from '../controllers/admin/analytics.controller';
import * as supportController from '../controllers/admin/support.controller';
import * as complianceController from '../controllers/admin/compliance.controller';
import * as serviceController from '../controllers/admin/service.controller';
import * as payoutController from '../controllers/admin/payout.controller';
import * as countryController from '../controllers/admin/country.controller';
import * as paymentAdminController from '../controllers/admin/payment.controller';
import * as providerAdminController from '../controllers/admin/provider.controller';
import * as userAdminController from '../controllers/admin/user.controller';
import * as disputeController from '../controllers/dispute.controller';
import * as auditController from '../controllers/admin/audit.controller';
import * as zoneController from '../controllers/admin/zone.controller';
import * as fraudAdminController from '../controllers/admin/fraud.controller';
import templateRouter from './admin/notification-template.routes';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]));

// Analytics
router.get('/analytics/summary', analyticsController.getOperationalAnalytics);
router.get('/analytics/operational', analyticsController.getOperationalAnalytics);

// Settings
router.get('/settings', settingsController.fetchSettings);
router.post('/settings', settingsController.saveSettings);

// Countries
router.get('/countries', countryController.listCountries);
router.post('/countries', countryController.createCountry);

// Services
router.get('/services', serviceController.listServices);
router.patch('/services/:serviceCode', serviceController.updateServiceRules);

// Payments (Admin)
router.get('/payments', paymentAdminController.listPayments);
router.patch('/payments/:id/refund', paymentAdminController.refundPayment);

// Providers
router.get('/providers/monitor', providerAdminController.getProvidersMonitor);
router.get('/providers/performance', providerAdminController.getProvidersPerformance);

// Users
router.get('/users', userAdminController.listUsers);

// Zones
router.get('/zones', zoneController.listZones);
router.post('/zones', zoneController.createZone);

// Fraud
router.get('/fraud/alerts', fraudAdminController.getFraudAlerts);

// Support
router.get('/tickets', supportController.listTickets);
router.patch('/tickets/:ticketId', supportController.updateTicket);
router.get('/disputes', disputeController.getDisputes);

// Audit
router.get('/audit-logs', auditController.listAuditLogs);

// Notification Templates
router.use('/notification-templates', templateRouter);

// Compliance
router.get('/compliance/export/:userId', complianceController.exportUserData);

// Payouts (Dashboard compatibility)
router.get('/payouts/admin', payoutController.listPayouts);
router.patch('/payouts/admin/:id/pay', payoutController.markPayoutPaid);

router.get('/verifications/pending', adminController.getPendingVerifications);
router.patch('/verifications/:providerId', adminController.verifyProvider);
router.get('/finance/overview', adminController.getFinancialOverview);
router.get('/finance/ledger', adminController.getDetailedLedger);

export default router;
