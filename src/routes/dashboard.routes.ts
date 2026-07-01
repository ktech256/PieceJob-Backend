import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/customer', authenticate, dashboardController.getCustomerDashboard);
router.get('/customer/promotions', authenticate, dashboardController.getCustomerPromotions);

export default router;
