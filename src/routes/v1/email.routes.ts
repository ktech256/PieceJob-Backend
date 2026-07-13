import express from 'express';
import * as emailController from '../../controllers/admin/email.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { UserRole } from '../../models/User';

const router = express.Router();

// Admin only routes
router.use(authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]));

router.get('/config', emailController.getEmailConfig);
router.patch('/config', emailController.updateEmailConfig);
router.get('/config/test-smtp', emailController.testSmtp);
router.post('/config/send-test', emailController.sendTestEmail);
router.post('/config/send-category-test', emailController.sendCategoryTest);

router.get('/templates', emailController.listTemplates);
router.get('/templates/:id', emailController.getTemplateDetails);
router.post('/templates', emailController.createTemplate);
router.patch('/templates/:id', emailController.updateTemplate);
router.get('/templates/:id/preview', emailController.previewTemplate);
router.post('/templates/:id/send-test', emailController.sendTemplateTest);

router.get('/logs', emailController.getEmailLogs);
router.post('/logs/:id/resend', emailController.resendEmail);

router.get('/analytics', emailController.getEmailAnalytics);

export default router;
