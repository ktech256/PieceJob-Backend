import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as walletService from '../../services/wallet.service';
import { TransactionType } from '../../models/Ledger';
import User from '../../models/User';
import Country from '../../models/Country';
import * as auditService from '../../services/audit.service';
import Wallet from '../../models/Wallet';
import mongoose from 'mongoose';

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
            type: type || (amount >= 0 ? TransactionType.MANUAL_CREDIT : TransactionType.MANUAL_DEBIT),
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

export const updateWalletStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { userId } = req.params;
        const { status, reason, isFrozen, isLocked, isSuspended } = req.body;
        const adminId = req.user?.userId;

        const wallet = await Wallet.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId) },
            {
                $set: {
                    status,
                    isFrozen,
                    isLocked,
                    isSuspended,
                    [`${status.toLowerCase()}Reason`]: reason
                }
            },
            { new: true, upsert: true }
        );

        await auditService.logAdminAction({
            countryCode: wallet.countryCode,
            adminId: adminId as string,
            adminRole: req.user?.role as string,
            action: `WALLET_${status}`,
            entityType: 'Wallet',
            entityId: wallet._id.toString(),
            afterState: { status, isFrozen, isLocked, isSuspended, reason },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, wallet });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
