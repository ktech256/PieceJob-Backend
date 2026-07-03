import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as walletService from '../../services/wallet.service';
import { TransactionType } from '../../models/Ledger';
import User from '../../models/User';
import Country from '../../models/Country';

export const manualWalletMutation = async (req: AuthRequest, res: Response) => {
    try {
        const { userId, amount, balanceType, type, reason } = req.body;
        const adminId = req.user?.userId;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const country = await Country.findOne({ code: user.countryCode });

        const result = await walletService.mutateWallet({
            userId,
            amount,
            type: type || TransactionType.MANUAL_CREDIT,
            balanceType: balanceType || 'balanceMain',
            description: reason || 'Manual Admin Adjustment',
            countryCode: user.countryCode,
            currency: country?.currency || 'USD',
            metadata: {
                manual: true,
                adminId,
                reason
            }
        });

        res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
