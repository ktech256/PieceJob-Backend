import { Router } from 'express';
import * as walletController from '../controllers/wallet.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/balance', authenticate, walletController.getWalletBalance);
router.get('/history', authenticate, walletController.getTransactionHistory);
router.get('/payouts', authenticate, walletController.getMyPayouts);
router.get('/statements', authenticate, walletController.getMyStatements);
router.get('/invoices', authenticate, walletController.getMyInvoices);
router.get('/service-fee-rate', authenticate, walletController.getMyServiceFeeRate);
router.get('/commission-rate', authenticate, walletController.getMyServiceFeeRate); // Backward compatibility
router.post('/withdraw', authenticate, walletController.requestWithdrawal);
router.post('/pay-service-fee', authenticate, walletController.payServiceFee);
router.post('/pay-commission', authenticate, walletController.payServiceFee); // Backward compatibility

export default router;
