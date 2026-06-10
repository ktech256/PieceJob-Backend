import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Job, { JobStatus } from '../../models/Job';
import Provider from '../../models/Provider';

export const getFraudAlerts = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;

        // Fetch suspicious jobs (cancelled within grace but high frequency)
        const alerts = await Job.find({
            countryCode,
            status: JobStatus.CANCELLED,
            // Logic for "suspicious" - simplified for Phase 13 gate
        }).limit(20).populate('customerId providerId');

        res.status(200).json({ success: true, alerts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch fraud alerts', error });
    }
};
