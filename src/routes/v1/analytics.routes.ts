import { Router } from 'express';
import * as analyticsController from '../../controllers/v1/analytics.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.get('/provider/summary', authenticate, analyticsController.getProviderAnalytics);
router.get('/customer/summary', authenticate, analyticsController.getCustomerAnalytics);

export default router;
