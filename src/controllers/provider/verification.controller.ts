import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Provider from '../../models/Provider';
import VerificationRequest from '../../models/VerificationRequest';
import * as verificationService from '../../services/verification.service';

export const getMyStatus = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const latestRequest = await VerificationRequest.findOne({ providerId: provider._id })
            .sort({ submittedAt: -1 });

        res.status(200).json({
            success: true,
            currentLevel: provider.verificationLevel,
            currentStatus: provider.verificationStatus,
            latestRequest
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch status', error });
    }
};

export const submitMyVerification = async (req: AuthRequest, res: Response) => {
    try {
        const { type, documents, extraData } = req.body;

        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const result = await verificationService.submitVerification(
            provider._id.toString(),
            type,
            documents,
            provider.countryCode,
            extraData
        );

        res.status(201).json({ success: true, request: result });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
