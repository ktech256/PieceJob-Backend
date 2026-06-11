import { Router } from 'express';
import * as supportController from '../controllers/support.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.post('/tickets', supportController.submitTicket);
router.get('/tickets', supportController.getMyTickets);

export default router;
