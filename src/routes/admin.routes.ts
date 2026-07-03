import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import * as settingsController from '../controllers/admin/settings.controller';
import * as analyticsController from '../controllers/admin/analytics.controller';
import * as supportController from '../controllers/admin/support.controller';
import * as complianceController from '../controllers/admin/compliance.controller';
import * as serviceController from '../controllers/admin/service.controller';
import * as categoryController from '../controllers/admin/service-category.controller';
import * as payoutController from '../controllers/admin/payout.controller';
import * as countryController from '../controllers/admin/country.controller';
import * as paymentAdminController from '../controllers/admin/payment.controller';
import * as providerAdminController from '../controllers/admin/provider.controller';
import * as userAdminController from '../controllers/admin/user.controller';
import * as disputeController from '../controllers/dispute.controller';
import * as auditController from '../controllers/admin/audit.controller';
import * as zoneController from '../controllers/admin/zone-management.controller';
import * as fraudAdminController from '../controllers/admin/fraud.controller';
import * as exchangeController from '../controllers/admin/exchange.controller';
import * as jobAdminController from '../controllers/admin/job.controller';
import * as financeController from '../controllers/admin/finance.controller';
import * as invoiceController from '../controllers/admin/invoice.controller';
import * as pricingAdminController from '../controllers/admin/pricing.controller';
import * as performanceAdminController from '../controllers/admin/provider-performance.controller';
import * as communicationAdminController from '../controllers/admin/communication.controller';
import * as customerAdminController from '../controllers/admin/customer.controller';
import * as corporateAdminController from '../controllers/admin/corporate.controller';
import * as walletAdminController from '../controllers/admin/wallet.controller';
import * as verificationAdminController from '../controllers/admin/verification.controller';
import * as ticketAdminController from '../controllers/admin/ticket.controller';
import * as adminUserController from '../controllers/admin/admin-user.controller';
import * as sosAdminController from '../controllers/sos.controller';
import * as integrationController from '../controllers/admin/integration.controller';
import * as marketingAdminController from '../controllers/admin/marketing.controller';
import * as paymentRoutingController from '../controllers/admin/payment-provider.controller';
import templateRouter from './admin/notification-template.routes';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { hasPermission } from '../middleware/permission.middleware';
import { tenantContext } from '../middleware/tenant.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(tenantContext);
router.use(authorize([UserRole.COUNTRY_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN]));

// Analytics
router.get('/analytics/summary', analyticsController.getOperationalAnalytics);
router.get('/analytics/operational', analyticsController.getOperationalAnalytics);
router.get('/analytics/global-breakdown', analyticsController.getGlobalBreakdown);
router.get('/analytics/live-ops', analyticsController.getLiveOpsData);
router.get('/analytics/heatmap', analyticsController.getHeatmapData);

// Settings
router.get('/settings', hasPermission('VIEW_AUDIT'), settingsController.fetchSettings);
router.post('/settings', hasPermission('MANAGE_PRICING'), settingsController.saveSettings);

// Countries / Workspaces
router.get('/countries', countryController.listCountries);
router.post('/countries', authorize([UserRole.SUPER_ADMIN]), countryController.createCountry);
router.patch('/countries/:id', authorize([UserRole.SUPER_ADMIN]), countryController.updateCountry);

// Admin Management (Super Admin only)
router.get('/management/admins', authorize([UserRole.SUPER_ADMIN]), adminUserController.listAdmins);
router.post('/management/admins', authorize([UserRole.SUPER_ADMIN]), adminUserController.createAdmin);
router.patch('/management/admins/:id', authorize([UserRole.SUPER_ADMIN]), adminUserController.updateAdmin);

// Exchange Rates
router.get('/exchange-rates', exchangeController.listRates);
router.post('/exchange-rates', exchangeController.updateRate);

// Services
router.get('/services', serviceController.listServices);
router.post('/services', serviceController.createService);
router.patch('/services/:id', serviceController.updateService);
router.delete('/services/:id', serviceController.deleteService);
router.patch('/services/:id/toggle', serviceController.toggleServiceStatus);
router.patch('/services/rules/:serviceCode', serviceController.updateServiceRules);

// Categories
router.get('/categories', categoryController.listCategories);
router.post('/categories', categoryController.createCategory);
router.patch('/categories/:id', categoryController.updateCategory);
router.delete('/categories/:id', categoryController.softDeleteCategory);
router.patch('/categories/:id/toggle', categoryController.toggleCategoryStatus);

// Integrations
router.get('/integrations', integrationController.listIntegrations);
router.patch('/integrations/:type', integrationController.updateIntegration);
router.post('/integrations/:type/rotate', integrationController.rotateKey);

// Payment Routing
router.get('/payment-providers', paymentRoutingController.listProviders);
router.post('/payment-providers', paymentRoutingController.createProvider);
router.patch('/payment-providers/:id', paymentRoutingController.updateProvider);
router.get('/payment-providers/methods', paymentRoutingController.getAvailableMethods);

// Payments (Admin)
router.get('/payments', paymentAdminController.listPayments);
router.patch('/payments/:id/refund', paymentAdminController.refundPayment);
router.post('/jobs/:jobId/refund', hasPermission('MANAGE_FINANCE'), financeController.processRefund);

// Providers
router.get('/providers/monitor', providerAdminController.getProvidersMonitor);
router.get('/providers/performance', providerAdminController.getProvidersPerformance);

// Users
router.get('/users', userAdminController.listUsers);

// Job Overrides & Details
router.get('/jobs/:jobId', hasPermission('VIEW_AUDIT'), jobAdminController.adminGetJobDetails);
router.patch('/jobs/:jobId/status', hasPermission('MANAGE_SUPPORT'), jobAdminController.adminUpdateJobStatus);

// Zones
router.get('/zones', zoneController.listZones);
router.post('/zones', zoneController.createZone);
router.get('/zones/:id/stats', zoneController.getZoneStats);
router.patch('/zones/:id', zoneController.updateZone);
router.delete('/zones/:id', zoneController.deleteZone);
router.patch('/zones/:id/toggle', zoneController.toggleZoneStatus);

// Fraud (PAGE 12)
router.get('/fraud/alerts', fraudAdminController.getFraudAlerts);
router.get('/fraud/analytics', fraudAdminController.getFraudAnalytics);
router.get('/fraud/fake-completion', fraudAdminController.getFakeCompletionQueue);
router.patch('/fraud/alerts/:id/resolve', fraudAdminController.resolveAlert);

// Support & Disputes (PAGE 9)
router.get('/tickets', hasPermission('MANAGE_SUPPORT'), ticketAdminController.listTickets);
router.get('/tickets/:id', hasPermission('MANAGE_SUPPORT'), ticketAdminController.getTicketDetail);
router.patch('/tickets/:id/assign', hasPermission('MANAGE_SUPPORT'), ticketAdminController.assignTicket);
router.patch('/tickets/:id/resolve', hasPermission('MANAGE_SUPPORT'), ticketAdminController.resolveTicket);
router.get('/tickets/:id/chat-vault', hasPermission('VIEW_CHATS'), ticketAdminController.getChatVault);
router.post('/tickets/:id/settle', hasPermission('MANAGE_FINANCE'), ticketAdminController.processEscrowSettlement);
router.get('/disputes', hasPermission('MANAGE_DISPUTES'), disputeController.getDisputes);

// Communication (PAGE 11)
router.get('/communication/chats', hasPermission('VIEW_CHATS'), communicationAdminController.listAllChats);
router.get('/communication/calls', hasPermission('VIEW_AUDIT'), communicationAdminController.listAllCalls);
router.get('/communication/reviews', hasPermission('VIEW_AUDIT'), communicationAdminController.listAllReviews);
router.get('/communication/disputes', hasPermission('VIEW_AUDIT'), communicationAdminController.listAllDisputes);

// SOS Hub (PAGE 10)
router.get('/sos/incidents', hasPermission('MANAGE_SOS'), sosAdminController.listIncidents);
router.get('/sos/incidents/:id', hasPermission('MANAGE_SOS'), sosAdminController.getIncidentDetail);
router.patch('/sos/incidents/:id/status', hasPermission('MANAGE_SOS'), sosAdminController.updateStatus);

// Audit
router.get('/audit-logs', hasPermission('VIEW_AUDIT'), auditController.listAuditLogs);

// Notification Templates
router.use('/notification-templates', templateRouter);

// Compliance
router.get('/compliance/export/:userId', complianceController.exportUserData);

// Payouts
router.get('/finance/payouts', hasPermission('MANAGE_FINANCE'), payoutController.listPayouts);
router.get('/finance/payouts/export', hasPermission('MANAGE_FINANCE'), payoutController.exportPayouts);
router.post('/finance/payouts/batch/approve', hasPermission('MANAGE_FINANCE'), payoutController.approveBatch);
router.post('/finance/payouts/batch/process', hasPermission('MANAGE_FINANCE'), payoutController.processBatch);
router.patch('/finance/payouts/:id/pay', hasPermission('MANAGE_FINANCE'), payoutController.markPayoutPaid);
router.patch('/finance/payouts/:id/reverse', hasPermission('MANAGE_FINANCE'), payoutController.reversePayout);

// Invoices
router.get('/finance/invoices', hasPermission('MANAGE_FINANCE'), invoiceController.listInvoices);
router.patch('/finance/invoices/:id/void', hasPermission('MANAGE_FINANCE'), invoiceController.voidInvoice);
router.post('/finance/invoices/:id/reissue', hasPermission('MANAGE_FINANCE'), invoiceController.reissueInvoice);
router.post('/finance/invoices/:id/credit-note', hasPermission('MANAGE_FINANCE'), invoiceController.createCreditNote);
router.post('/finance/invoices/:id/debit-note', hasPermission('MANAGE_FINANCE'), invoiceController.createDebitNote);

// Reconciliation & Statements
router.get('/finance/overview', hasPermission('MANAGE_FINANCE'), financeController.getOverview);
router.get('/finance/ledger', hasPermission('MANAGE_FINANCE'), financeController.getLedger);
router.get('/finance/wallets', hasPermission('MANAGE_FINANCE'), financeController.listWallets);
router.get('/finance/refunds', hasPermission('MANAGE_FINANCE'), financeController.listRefunds);
router.get('/finance/referrals', hasPermission('MANAGE_FINANCE'), financeController.listReferrals);
router.post('/finance/reconciliation/run', hasPermission('MANAGE_FINANCE'), financeController.runReconciliation);
router.post('/finance/statements/provider/generate', hasPermission('MANAGE_FINANCE'), financeController.generateProviderStatement);

// Pricing & Rules (PAGE 4)
router.get('/pricing/rules', hasPermission('MANAGE_PRICING'), pricingAdminController.listPricingRules);
router.post('/pricing/rules', hasPermission('MANAGE_PRICING'), pricingAdminController.createPricingRule);
router.patch('/pricing/rules/:id', hasPermission('MANAGE_PRICING'), pricingAdminController.updatePricingRule);
router.delete('/pricing/rules/:id', hasPermission('MANAGE_PRICING'), pricingAdminController.deletePricingRule);
router.get('/pricing/commissions', hasPermission('MANAGE_PRICING'), pricingAdminController.listCommissions);
router.post('/pricing/commissions', hasPermission('MANAGE_PRICING'), pricingAdminController.updateCommission);
router.get('/pricing/pricebot', hasPermission('MANAGE_PRICING'), pricingAdminController.getPriceBotSuggestions);
router.post('/pricing/pricebot/analyze', hasPermission('MANAGE_PRICING'), pricingAdminController.triggerPriceBot);
router.get('/pricing/simulate', hasPermission('MANAGE_PRICING'), pricingAdminController.simulatePricing);

// Verifications (PAGE 8)
router.get('/verifications/queue', hasPermission('MANAGE_VERIFICATION'), verificationAdminController.listQueue);
router.get('/verifications/addresses', hasPermission('MANAGE_VERIFICATION'), providerAdminController.listPendingAddressChanges);
router.patch('/verifications/addresses/:providerId/approve', hasPermission('MANAGE_VERIFICATION'), providerAdminController.approveAddressChange);
router.patch('/verifications/addresses/:providerId/reject', hasPermission('MANAGE_VERIFICATION'), providerAdminController.rejectAddressChange);
router.get('/verifications/banking', hasPermission('MANAGE_VERIFICATION'), providerAdminController.listPendingBankDetails);
router.patch('/verifications/banking/:providerId/approve', hasPermission('MANAGE_VERIFICATION'), providerAdminController.approveBankDetails);
router.patch('/verifications/banking/:providerId/reject', hasPermission('MANAGE_VERIFICATION'), providerAdminController.rejectBankDetails);
router.post('/providers/:providerId/request-revetting', hasPermission('MANAGE_VERIFICATION'), providerAdminController.requestRevetting);
router.get('/verifications/:id', hasPermission('MANAGE_VERIFICATION'), verificationAdminController.getRequestDetail);
router.patch('/verifications/:id/review', hasPermission('MANAGE_VERIFICATION'), verificationAdminController.review);

router.get('/verifications/pending', hasPermission('MANAGE_VERIFICATION'), adminController.getPendingVerifications);
router.patch('/verifications/:providerId', hasPermission('MANAGE_VERIFICATION'), adminController.verifyProvider);

// Provider Performance & Monitoring (PAGE 7)
router.get('/performance/list', hasPermission('MANAGE_PROVIDERS'), performanceAdminController.listTopProviders);
router.get('/performance/:providerId', hasPermission('MANAGE_PROVIDERS'), performanceAdminController.getProviderPerformanceDetail);
router.patch('/performance/:providerId/lifecycle', hasPermission('MANAGE_PROVIDERS'), performanceAdminController.updateProviderLifecycle);
router.get('/performance/analytics', hasPermission('VIEW_REPORTS'), performanceAdminController.getPerformanceAnalytics);
router.post('/performance/recalculate', hasPermission('MANAGE_PROVIDERS'), performanceAdminController.triggerMetricRecalculation);

// Users (PAGE 7)
router.get('/users/customers', hasPermission('MANAGE_CUSTOMERS'), customerAdminController.listCustomers);
// ...
router.post('/users/wallet/mutate', hasPermission('MANAGE_WALLETS'), walletAdminController.manualWalletMutation);

// Marketing (NEW)
router.get('/marketing/promotions', hasPermission('MANAGE_CUSTOMERS'), marketingAdminController.listPromotions);
router.post('/marketing/promotions', hasPermission('MANAGE_CUSTOMERS'), marketingAdminController.createPromotion);
router.patch('/marketing/promotions/:id', hasPermission('MANAGE_CUSTOMERS'), marketingAdminController.updatePromotion);
router.delete('/marketing/promotions/:id', hasPermission('MANAGE_CUSTOMERS'), marketingAdminController.deletePromotion);
router.post('/marketing/notifications/push', hasPermission('MANAGE_CUSTOMERS'), marketingAdminController.sendCustomPush);

// Test Seeding & Cleanup
router.delete('/maintenance/test-users', authorize([UserRole.SUPER_ADMIN]), adminController.cleanupTestUsers);

export default router;
