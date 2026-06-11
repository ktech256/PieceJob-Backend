import { Router } from 'express';
import * as corporateController from '../controllers/corporate.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(authorize([UserRole.CORPORATE_OWNER, UserRole.CORPORATE_ADMIN]));

router.get('/profile', corporateController.getMyCompanyProfile);
router.get('/employees', corporateController.getMyEmployees);
router.get('/schedules', corporateController.getMySchedules);

export default router;
