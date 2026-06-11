import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as walletService from '../../services/wallet.service';
import { TransactionType } from '../../models/Ledger';

export const manualWalletMutation = async (req: AuthRequest, res: Response) => {
    try {
        const { userId, amount, type, reason } = req.body;
        const adminId = req.user?.userId;

        const result = await walletService.mutateWallet(
            userId,
            amount,
            type as walletService.WalletType,
            TransactionType.BONUS, // Or specific type based on reason
            { reason, manual: true },
            adminId
        );

        res.status(200).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
