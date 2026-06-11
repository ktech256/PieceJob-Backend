import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import VerificationRequest from '../../models/VerificationRequest';
import * as verificationService from '../../services/verification.service';

export const listQueue = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode, status, type } = req.query;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (status) query.status = status;
        if (type) query.type = type;

        const queue = await VerificationRequest.find(query)
            .populate({
                path: 'providerId',
                populate: { path: 'userId', select: 'firstName lastName email phoneNumber' }
            })
            .sort({ submittedAt: -1 });

        res.status(200).json({ success: true, queue });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch queue', error });
    }
};

export const getRequestDetail = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const request = await VerificationRequest.findById(id)
            .populate({
                path: 'providerId',
                populate: { path: 'userId', select: 'firstName lastName email phoneNumber' }
            });

        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        res.status(200).json({ success: true, request });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch details', error });
    }
};

export const review = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason, documentStatusUpdates } = req.body;

        const result = await verificationService.reviewRequest(
            id,
            req.user?.userId as string,
            status,
            rejectionReason,
            documentStatusUpdates
        );

        res.status(200).json({ success: true, request: result });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
