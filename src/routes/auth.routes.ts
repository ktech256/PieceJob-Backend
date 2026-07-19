import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.get('/check-phone/:phoneNumber', authController.checkPhone);
router.post('/register/customer', authController.registerCustomer);
router.post('/register/provider', authController.registerProvider);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/change-password', authenticate, authController.changePassword);
router.get('/referrals/validate/:code', authController.validateReferralCode);
router.post('/logout-all', authenticate, authController.logoutAllDevices);
router.post('/request-phone-change', authenticate, authController.requestPhoneChange);
router.post('/verify-phone-change', authenticate, authController.verifyPhoneChange);
router.post('/request-email-change', authenticate, authController.requestEmailChange);
router.post('/verify-email-change', authenticate, authController.verifyEmailChange);
router.get('/devices', authenticate, authController.getDevices);
router.delete('/devices/:id', authenticate, authController.removeDevice);

export default router;
