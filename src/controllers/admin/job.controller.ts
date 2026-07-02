import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Job, { JobStatus } from '../../models/Job';
import AuditLog from '../../models/AuditLog';
import Ledger from '../../models/Ledger';
import Call from '../../models/Call';
import Chat from '../../models/Chat';
import Provider from '../../models/Provider';
import Review from '../../models/Review';
import { emitJobUpdate, emitToUser } from '../../socket/socket.service';
import * as notificationService from '../../services/notification.service';
import { logger } from '../../utils/logger';
import mongoose from 'mongoose';

export const adminGetJobDetails = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const job = await Job.findById(jobId)
            .populate('customerId', 'firstName lastName email phoneNumber profilePhoto')
            .populate('providerId', 'firstName lastName email phoneNumber profilePhoto')
            .populate('cancelledBy', 'firstName lastName role');

        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const [ledger, calls, auditLogs, providerProfile, reviews] = await Promise.all([
            Ledger.find({ jobId }).sort({ createdAt: -1 }),
            Call.find({ jobId }).sort({ createdAt: -1 }),
            AuditLog.find({ targetId: jobId }).sort({ createdAt: -1 }).populate('adminId', 'firstName lastName'),
            job.providerId ? Provider.findOne({ userId: job.providerId }) : null,
            Review.find({ jobId })
        ]);

        // Get chat message count
        const chatCount = await Chat.countDocuments({ jobId });

        res.status(200).json({
            success: true,
            data: {
                job,
                ledger,
                calls,
                auditLogs,
                providerProfile,
                reviews,
                chatCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch job details', error });
    }
};

export const adminUpdateJobStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const { status, reason } = req.body;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const previousStatus = job.status;
        job.status = status;

        if (status === JobStatus.CANCELLED) {
            job.cancelledBy = req.user?.userId as any;
            job.cancellationReason = `[ADMIN OVERRIDE] ${reason}`;

            // If it was broadcasted, we need to clear broadcasts
            try {
                const { clearJobBroadcasts } = require('../../services/job-broadcast.queue');
                await clearJobBroadcasts(jobId);
            } catch (e) {
                logger.error(`[ADMIN] Error clearing broadcasts: ${e}`);
            }

            // If it had a provider, make them online again
            if (job.providerId) {
                await Provider.findOneAndUpdate(
                    { userId: job.providerId },
                    { currentAvailabilityStatus: 'ONLINE' }
                );
            }
        }

        if (status === JobStatus.STARTED) {
            job.startedAt = new Date();
        }

        if (status === JobStatus.COMPLETED) {
            job.completedAt = new Date();
            // Note: Financials might need manual handling if skipped, but simple override for now.
        }

        await job.save();

        // Audit Log
        await AuditLog.create({
            adminId: req.user?.userId,
            action: 'ADMIN_JOB_OVERRIDE',
            targetId: jobId,
            targetCollection: 'Jobs',
            previousValue: { status: previousStatus },
            newValue: { status, reason },
            ipAddress: req.ip
        });

        // Notifications & Sockets
        const statusPayload = { jobId: job.id, status, adminOverride: true, reason };
        emitJobUpdate(job.id, 'status_updated', statusPayload);
        emitToUser(job.customerId.toString(), 'status_updated', statusPayload);
        if (job.providerId) emitToUser(job.providerId.toString(), 'status_updated', statusPayload);

        notificationService.notifyUser(
            job.customerId.toString(),
            'Job Status Updated',
            `Administrator has manually updated your job to ${status}.`
        );

        if (job.providerId) {
            notificationService.notifyUser(
                job.providerId.toString(),
                'Job Status Updated',
                `Administrator has manually updated your job to ${status}.`
            );
        }

        res.status(200).json({ success: true, message: `Job status updated to ${status}` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
