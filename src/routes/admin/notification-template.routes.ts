import { Router } from 'express';
import * as templateController from '../../controllers/admin/notification-template.controller';

const router = Router();

router.get('/', templateController.listTemplates);
router.post('/', templateController.createTemplate);
router.patch('/:id', templateController.updateTemplate);

export default router;
