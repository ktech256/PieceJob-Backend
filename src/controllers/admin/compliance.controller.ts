import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User from '../../models/User';
import Provider from '../../models/Provider';
import Wallet from '../../models/Wallet';
import Ledger from '../../models/Ledger';

export const exportUserData = async (req: AuthRequest, res: Response) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId).lean();
        const profile = await Provider.findOne({ userId }).lean();
        const wallet = await Wallet.findOne({ userId }).lean();
        const txs = await Ledger.find({ $or: [{ fromUserId: userId }, { toUserId: userId }] }).lean();

        const bundle = {
            metadata: {
                exportedAt: new Date(),
                compliance: "GDPR/POPIA"
            },
            identity: user,
            professionalProfile: profile,
            financials: {
                wallet,
                transactions: txs
            }
        };

        res.status(200).json({ success: true, data: bundle });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Export failed', error });
    }
};
