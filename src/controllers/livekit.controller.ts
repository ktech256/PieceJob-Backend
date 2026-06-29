import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AccessToken } from 'livekit-server-sdk';
import Job from '../models/Job';
import User from '../models/User';

export const getLiveKitToken = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.query;
        const userId = req.user?.userId;

        if (!jobId) {
            return res.status(400).json({ success: false, message: 'Job ID is required' });
        }

        const user = await User.findById(userId);
        const firstName = user?.firstName || 'User';

        // Verify that the user is part of this job
        const job = await Job.findById(jobId);
        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        const isParticipant = job.customerId.toString() === userId || job.providerId?.toString() === userId;
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Not a participant of this job' });
        }

        const inactiveStatuses = ['DRAFT', 'REQUEST_CREATED', 'COMPLETED', 'RATED', 'CLOSED', 'CANCELLED'];
        if (inactiveStatuses.includes(job.status)) {
            return res.status(403).json({ success: false, message: `Calls are not allowed when job is ${job.status}` });
        }

        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;

        if (!apiKey || !apiSecret) {
            console.error('LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set');
            return res.status(500).json({ success: false, message: 'LiveKit configuration missing on server' });
        }

        const at = new AccessToken(apiKey, apiSecret, {
            identity: userId,
            name: firstName,
        });

        at.addGrant({
            roomJoin: true,
            room: `job_${jobId}`,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });

        const token = await at.toJwt();
        res.status(200).json({ success: true, data: { token } });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
