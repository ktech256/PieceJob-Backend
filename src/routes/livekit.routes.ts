import { Router } from 'express';
import * as livekitController from '../controllers/livekit.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/token', authenticate, livekitController.getLiveKitToken);

export default router;
