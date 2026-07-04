import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Job, { JobStatus } from '../models/Job';
import PriceProposal from '../models/PriceProposal';
import ChatMessage from '../models/Chat';
import SystemSettings from '../models/SystemSettings';
import { emitJobUpdate } from '../socket/socket.service';
import * as notificationService from '../services/notification.service';
import mongoose from 'mongoose';

export const proposePrice = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, amount, note } = req.body;
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

        const receiverId = job.customerId.toString() === senderId ? job.providerId : job.customerId;
        if (!receiverId) return res.status(400).json({ success: false, message: 'No counterparty assigned' });

        // Mark previous proposals as COUNTERED if this is a counter offer
        await PriceProposal.updateMany({ jobId, status: 'PENDING' }, { status: 'COUNTERED' });

        const proposal = new PriceProposal({
            jobId,
            senderId,
            receiverId,
            amount,
            note,
            round: (job.negotiationRounds || 0) + 1,
            countryCode: job.countryCode
        });

        await proposal.save();

        job.negotiationRounds = (job.negotiationRounds || 0) + 1;
        job.priceStatus = 'PENDING';
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
                note,
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

            // Requirements: Provider can now start the job.
            // If the job was just ACCEPTED, it might move to EN_ROUTE automatically or something.
            // For now just keep status.

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
            emitJobUpdate(job._id.toString(), 'status_updated', { jobId: job._id, priceStatus: 'ACCEPTED', agreedPrice: job.agreedPrice });

            await notificationService.notifyUser(
                proposal.senderId.toString(),
                'Price Accepted',
                `The price proposal of ${proposal.amount} has been accepted.`,
                { type: 'PRICE_ACCEPTED', jobId: job._id.toString() }
            );

        } else {
            proposal.status = 'REJECTED';
            job.priceStatus = 'REJECTED';
            await job.save();
            await proposal.save();

            const chatMsg = new ChatMessage({
                jobId: job._id,
                senderId: userId,
                receiverId: proposal.senderId,
                text: 'Price Proposal Rejected',
                metadata: { type: 'PRICE_REJECTED' }
            });
            await chatMsg.save();

            const data = await ChatMessage.findById(chatMsg._id).populate('senderId', 'firstName lastName role profilePhoto');
            emitJobUpdate(job._id.toString(), 'new_message', data);

            await notificationService.notifyUser(
                proposal.senderId.toString(),
                'Price Rejected',
                'Your price proposal was rejected.',
                { type: 'PRICE_REJECTED', jobId: job._id.toString() }
            );
        }

        res.status(200).json({ success: true, proposal });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to respond to proposal', error });
    }
};
