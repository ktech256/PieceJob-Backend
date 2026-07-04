import { Router } from 'express';
import * as negotiationController from '../controllers/negotiation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/propose', authenticate, negotiationController.proposePrice);
router.post('/respond/:proposalId', authenticate, negotiationController.respondToProposal);

export default router;
