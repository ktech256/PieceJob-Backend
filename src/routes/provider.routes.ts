import { Router } from 'express';
import * as providerController from '../controllers/provider.controller';
import * as verificationController from '../controllers/provider/verification.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.get('/profile', authenticate, authorize([UserRole.PROVIDER]), providerController.getProviderProfile);
router.patch('/profile', authenticate, authorize([UserRole.PROVIDER]), providerController.updateProfile);
router.get('/services', authenticate, authorize([UserRole.PROVIDER]), providerController.getMyServices);
router.post('/services', authenticate, authorize([UserRole.PROVIDER]), providerController.updateServices);
router.get('/equipment', authenticate, authorize([UserRole.PROVIDER]), providerController.getEquipment);
router.post('/equipment', authenticate, authorize([UserRole.PROVIDER]), providerController.addEquipment);
router.get('/certifications', authenticate, authorize([UserRole.PROVIDER]), providerController.getCertifications);
router.post('/certifications', authenticate, authorize([UserRole.PROVIDER]), providerController.addCertification);
router.get('/experience', authenticate, authorize([UserRole.PROVIDER]), providerController.getExperience);
router.post('/experience', authenticate, authorize([UserRole.PROVIDER]), providerController.addExperience);
router.get('/bank', authenticate, authorize([UserRole.PROVIDER]), providerController.getBankDetails);
router.post('/bank', authenticate, authorize([UserRole.PROVIDER]), providerController.updateBankDetails);
router.patch('/wallet-settings', authenticate, authorize([UserRole.PROVIDER]), providerController.updateWalletSettings);
router.patch('/notifications', authenticate, authorize([UserRole.PROVIDER]), providerController.updateNotificationSettings);
router.patch('/:providerId/address/approve', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), providerController.approveAddressChange);
router.patch('/:providerId/address/reject', authenticate, authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]), providerController.rejectAddressChange);
router.get('/dashboard-stats', authenticate, authorize([UserRole.PROVIDER]), providerController.getDashboardStats);
router.get('/verification/status', authenticate, authorize([UserRole.PROVIDER]), verificationController.getMyStatus);
router.get('/verification/requirements', authenticate, authorize([UserRole.PROVIDER]), verificationController.getRequirements);
router.post('/verification/submit', authenticate, authorize([UserRole.PROVIDER]), verificationController.submitMyVerification);
router.patch('/status', authenticate, authorize([UserRole.PROVIDER]), providerController.updateStatus);
router.post('/heartbeat', authenticate, authorize([UserRole.PROVIDER]), providerController.handleHeartbeat);
router.post('/documents', authenticate, authorize([UserRole.PROVIDER]), providerController.uploadDocument);

export default router;
