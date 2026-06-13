import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register/customer', authController.registerCustomer);
router.post('/register/provider', authController.registerProvider);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/change-password', authenticate, authController.changePassword);
router.post('/logout-all', authenticate, authController.logoutAllDevices);
router.get('/devices', authenticate, authController.getDevices);
router.delete('/devices/:id', authenticate, authController.removeDevice);

export default router;
