import { Router } from 'express';
import * as configController from '../controllers/config.controller';

const router = Router();

router.get('/workspace', configController.getWorkspaceConfig);
router.get('/services', configController.getPublicServices);
router.get('/pricing/estimate', configController.getPriceEstimate);
router.get('/zones/resolve', configController.resolveZone);
router.get('/countries', configController.getCountries);
router.get('/languages', configController.getLanguages);

export default router;
