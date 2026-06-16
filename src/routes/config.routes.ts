import { Router } from 'express';
import * as configController from '../controllers/config.controller';
import * as integrationController from '../controllers/admin/integration.controller';
import * as paymentRoutingController from '../controllers/admin/payment-provider.controller';

const router = Router();

router.get('/workspace', configController.getWorkspaceConfig);
router.get('/categories', configController.getPublicCategories);
router.get('/services', configController.getPublicServices);
router.get('/pricing/estimate', configController.getPriceEstimate);
router.get('/zones/resolve', configController.resolveZone);
router.get('/countries', configController.getCountries);
router.get('/languages', configController.getLanguages);
router.get('/integrations', integrationController.getPublicConfig);
router.get('/payment-methods', paymentRoutingController.getAvailableMethods);

export default router;
