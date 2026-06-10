import { Router } from 'express';
import * as walletController from '../controllers/wallet.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/balance', authenticate, walletController.getWalletBalance);
router.get('/history', authenticate, walletController.getTransactionHistory);

export default router;
