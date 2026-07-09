import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Job, { JobStatus } from '../../models/Job';
import AuditLog from '../../models/AuditLog';
import Ledger from '../../models/Ledger';
import Call from '../../models/Call';
import Chat from '../../models/Chat';
import Provider from '../../models/Provider';
import Review from '../../models/Review';
import { emitJobUpdate, emitToUser, emitToWorkspace } from '../../socket/socket.service';
import * as notificationService from '../../services/notification.service';
import * as auditService from '../../services/audit.service';
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

import * as jobService from '../../services/job.service';

export const adminUpdateJobStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const { status, reason } = req.body;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const previousStatus = job.status;

        if (status === JobStatus.COMPLETED) {
            await jobService.completeJob(jobId, true);
        } else {
            job.status = status;

            if (status === JobStatus.CANCELLED) {
                job.cancelledAt = new Date();
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

            await job.save();

            // Unified Real-Time Sync for non-completed overrides
            const { syncJobStatus } = require('../../socket/socket.service');
            syncJobStatus(job, 'status_updated', { adminOverride: true, reason });

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
        }

        // Audit Log
        await auditService.logAdminAction({
            countryCode: job.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'ADMIN_JOB_OVERRIDE',
            entityType: 'Jobs',
            entityId: jobId,
            beforeState: { status: previousStatus },
            afterState: { status, reason },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, message: `Job status updated to ${status}` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
