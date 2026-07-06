import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Job, { JobStatus } from '../models/Job';
import PriceProposal from '../models/PriceProposal';
import ChatMessage from '../models/Chat';
import ServiceFeeRecord from '../models/ServiceFeeRecord';
import SystemSettings from '../models/SystemSettings';
import { emitJobUpdate } from '../socket/socket.service';
import * as notificationService from '../services/notification.service';
import mongoose from 'mongoose';

export const proposePrice = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, amount } = req.body;
        const senderId = req.user?.userId;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const isParticipant = job.customerId.toString() === senderId || job.providerId?.toString() === senderId;
        if (!isParticipant) return res.status(403).json({ success: false, message: 'Unauthorized' });

        if (job.priceStatus === 'ACCEPTED') {
            return res.status(400).json({ success: false, message: 'Price already agreed' });
        }

        const settings = await SystemSettings.findOne({ countryCode: job.countryCode }) || await SystemSettings.findOne({ countryCode: 'GLOBAL' });
        const maxRounds = settings?.maxNegotiationRounds || 4;

        if ((job.negotiationRounds || 0) >= maxRounds) {
            return res.status(400).json({ success: false, message: 'Maximum negotiation rounds reached' });
        }

        // VALIDATION: Photo Sharing Requirement
        const service = await mongoose.model('Service').findOne({
            code: job.serviceCode,
            countryCode: { $in: [job.countryCode, 'GLOBAL'] }
        }).sort({ countryCode: -1 });

        if (service?.photoSharingRequired && !job.taskPhotosSeen) {
            return res.status(403).json({
                success: false,
                message: 'You must review the task photos before proposing a price.'
            });
        }

        const receiverId = job.customerId.toString() === senderId ? job.providerId : job.customerId;
        if (!receiverId) return res.status(400).json({ success: false, message: 'No counterparty assigned' });

        // Mark previous proposals as COUNTERED if this is a counter offer
        await PriceProposal.updateMany({ jobId, status: 'PENDING' }, { status: 'COUNTERED' });

        const proposal = new PriceProposal({
            jobId,
            senderId,
            receiverId,
            amount,
            round: (job.negotiationRounds || 0) + 1,
            countryCode: job.countryCode
        });

        await proposal.save();

        job.negotiationRounds = (job.negotiationRounds || 0) + 1;
        job.priceStatus = 'PENDING';
        job.negotiationTimeline.push({
            event: 'PRICE_PROPOSED',
            timestamp: new Date(),
            metadata: { amount, round: job.negotiationRounds, senderId }
        });
        await job.save();

        // Send a structured message in chat
        const chatMsg = new ChatMessage({
            jobId,
            senderId,
            receiverId,
            text: `Price Proposal: ${amount}`,
            metadata: {
                type: 'PRICE_PROPOSAL',
                proposalId: proposal._id,
                amount,
                round: proposal.round
            }
        });
        await chatMsg.save();

        const data = await ChatMessage.findById(chatMsg._id).populate('senderId', 'firstName lastName role profilePhoto');
        emitJobUpdate(jobId, 'new_message', data);

        await notificationService.notifyUser(
            receiverId.toString(),
            'New Price Proposal',
            `A new price of ${amount} has been proposed for your job.`,
            { type: 'PRICE_PROPOSAL', jobId: jobId.toString(), proposalId: proposal._id.toString() }
        );

        res.status(201).json({ success: true, proposal });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to propose price', error });
    }
};

export const respondToProposal = async (req: AuthRequest, res: Response) => {
    try {
        const { proposalId } = req.params;
        const { action } = req.body; // 'ACCEPT' or 'REJECT'
        const userId = req.user?.userId;

        const proposal = await PriceProposal.findById(proposalId);
        if (!proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });

        if (proposal.receiverId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        if (proposal.status !== 'PENDING') {
            return res.status(400).json({ success: false, message: 'Proposal is no longer active' });
        }

        const job = await Job.findById(proposal.jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (action === 'ACCEPT') {
            proposal.status = 'ACCEPTED';
            job.agreedPrice = proposal.amount;
            job.priceAcceptedAt = new Date();
            job.priceAcceptedBy = new mongoose.Types.ObjectId(userId);
            job.priceStatus = 'ACCEPTED';

            job.negotiationTimeline.push({
                event: 'PRICE_ACCEPTED',
                timestamp: new Date(),
                metadata: { amount: proposal.amount, acceptedBy: userId }
            });

            // PHASE 3: Now dispatch provider
            if (job.status === JobStatus.PROVIDER_ACCEPTED) {
                job.status = JobStatus.ACCEPTED;

                // Record Timeline Event
                const serviceFeeRecord = await ServiceFeeRecord.findOne({ jobId: job._id });
                if (serviceFeeRecord) {
                    serviceFeeRecord.timeline.push({
                        event: 'PRICE_ACCEPTED_DISPATCH_ENABLED',
                        timestamp: new Date(),
                        metadata: { agreedPrice: proposal.amount }
                    });
                    await serviceFeeRecord.save();
                }
            }

            await job.save();
            await proposal.save();

            // Notify via chat
            const chatMsg = new ChatMessage({
                jobId: job._id,
                senderId: userId,
                receiverId: proposal.senderId,
                text: 'Price Accepted',
                metadata: { type: 'PRICE_ACCEPTED', amount: proposal.amount }
            });
            await chatMsg.save();

            const data = await ChatMessage.findById(chatMsg._id).populate('senderId', 'firstName lastName role profilePhoto');
            emitJobUpdate(job._id.toString(), 'new_message', data);
            emitJobUpdate(job._id.toString(), 'status_updated', { jobId: job._id, status: job.status, priceStatus: 'ACCEPTED', agreedPrice: job.agreedPrice });

            await notificationService.notifyUser(
                proposal.senderId.toString(),
                'Price Accepted',
                `The price proposal of ${proposal.amount} has been accepted.`,
                { type: 'PRICE_ACCEPTED', jobId: job._id.toString() }
            );

        } else {
            proposal.status = 'REJECTED';
            job.priceStatus = 'REJECTED';

            // spec: Automatically re-broadcast job. Exclude rejected provider permanently.
            const rejectedProviderId = job.providerId;
            if (rejectedProviderId) {
                job.notifiedProviderIds = job.notifiedProviderIds || [];
                // Add to notified list to prevent re-matching in Waves
                job.notifiedProviderIds.push(new mongoose.Types.ObjectId(rejectedProviderId.toString()));
            }
            job.providerId = undefined;
            job.status = JobStatus.BROADCASTED;
            job.negotiationRounds = 0;
            job.priceStatus = undefined;

            job.negotiationTimeline.push({
                event: 'PROVIDER_REJECTED_FINAL_ROUND',
                timestamp: new Date(),
                metadata: { providerId: rejectedProviderId }
            });

            await job.save();
            await proposal.save();

            // Re-broadcast logic
            const { broadcastJob } = require('../services/job.service');
            await broadcastJob(job._id.toString());

            // Notify participants
            const chatMsg = new ChatMessage({
                jobId: job._id,
                senderId: userId,
                receiverId: proposal.senderId,
                text: 'Negotiation failed. Re-broadcasting job to other providers.',
                metadata: { type: 'PRICE_REJECTED' }
            });
            await chatMsg.save();

            const data = await ChatMessage.findById(chatMsg._id).populate('senderId', 'firstName lastName role profilePhoto');
            emitJobUpdate(job._id.toString(), 'new_message', data);
            emitJobUpdate(job._id.toString(), 'status_updated', { jobId: job._id, status: JobStatus.BROADCASTED, providerId: null });

            if (rejectedProviderId) {
                await notificationService.notifyUser(
                    rejectedProviderId.toString(),
                    'Negotiation Terminated',
                    'The customer has rejected the final proposal. This job is no longer available to you.',
                    { type: 'PRICE_REJECTED', jobId: job._id.toString() }
                );
            }
        }

        res.status(200).json({ success: true, proposal });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to respond to proposal', error });
    }
};

export const rebroadcastJob = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const providerId = req.user?.userId;
        const { reason } = req.body;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (job.providerId?.toString() !== providerId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const settings = await SystemSettings.findOne({ countryCode: job.countryCode }) || await SystemSettings.findOne({ countryCode: 'GLOBAL' });
        const maxRounds = settings?.maxNegotiationRounds || 4;

        if ((job.negotiationRounds || 0) < maxRounds && job.priceStatus !== 'REJECTED') {
            return res.status(400).json({ success: false, message: 'Negotiation still valid' });
        }

        // Reset Job for broadcast
        job.providerId = undefined;
        job.status = JobStatus.BROADCASTED;
        job.priceStatus = undefined;
        job.negotiationRounds = 0;
        job.negotiationTimeline.push({
            event: 'JOB_REBROADCASTED_FROM_NEGOTIATION',
            timestamp: new Date(),
            metadata: { previousProvider: providerId, reason }
        });

        await job.save();

        const { broadcastJob } = require('../services/job.service');
        await broadcastJob(jobId);

        emitJobUpdate(jobId, 'status_updated', { jobId, status: JobStatus.BROADCASTED, providerId: null });

        res.status(200).json({ success: true, message: 'Job rebroadcasted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Rebroadcast failed', error });
    }
};
