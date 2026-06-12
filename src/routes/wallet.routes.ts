import { Router } from 'express';
import * as walletController from '../controllers/wallet.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/balance', authenticate, walletController.getWalletBalance);
router.get('/history', authenticate, walletController.getTransactionHistory);
router.get('/payouts', authenticate, walletController.getMyPayouts);
router.get('/statements', authenticate, walletController.getMyStatements);
router.get('/invoices', authenticate, walletController.getMyInvoices);
router.get('/commission-rate', authenticate, walletController.getMyCommissionRate);

export default router;
