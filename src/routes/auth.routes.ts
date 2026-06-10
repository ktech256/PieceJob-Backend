import { Router } from 'express';
import * as authController from '../controllers/auth.controller';

const router = Router();

router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register/customer', authController.registerCustomer);
router.post('/register/provider', authController.registerProvider);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);

export default router;
