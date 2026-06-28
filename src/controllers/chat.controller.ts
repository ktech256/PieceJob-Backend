import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Message from '../models/Chat';
import Job from '../models/Job';
import User, { UserRole } from '../models/User';
import * as notificationService from '../services/notification.service';
import { emitToUser, emitJobUpdate } from '../socket/socket.service';

export const getJobMessages = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const userId = req.user?.userId;
        const role = req.user?.role;

        // Ensure user is part of the job or is an admin
        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const isAdmin = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN].includes(role as UserRole);
        const isParticipant = job.customerId.toString() === userId || job.providerId?.toString() === userId;

        if (!isAdmin && !isParticipant) {
            return res.status(403).json({ success: false, message: 'Unauthorized to access this chat' });
        }

        const messages = await Message.find({ jobId })
            .sort({ createdAt: 1 })
            .populate('senderId', 'firstName lastName role profilePicture');

        res.status(200).json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch messages', error });
    }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, receiverId, text, mediaUrl, mediaType } = req.body;
        const senderId = req.user?.userId;

        // Validate participants
        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const isParticipant = job.customerId.toString() === senderId || job.providerId?.toString() === senderId;
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: 'Unauthorized: You are not a participant of this job' });
        }

        const message = new Message({
            jobId,
            senderId,
            receiverId,
            text,
            mediaUrl,
            mediaType
        });

        await message.save();

        const populatedMessage = await Message.findById(message._id).populate('senderId', 'firstName lastName role profilePicture');

        // 1. Emit via Socket to Job Room (for live updates in Chat Screen)
        emitJobUpdate(jobId, 'new_message', populatedMessage);

        // 2. Emit to Receiver's User Room (for unread counts/global notifications)
        emitToUser(receiverId, 'unread_message', { jobId, senderId });

        // 3. Notify Receiver via FCM
        const sender = await User.findById(senderId);
        const senderName = sender?.firstName || 'Someone';
        await notificationService.notifyUser(
            receiverId,
            `${senderName}`,
            text || 'Sent an attachment',
            {
                type: 'NEW_CHAT_MESSAGE',
                jobId: jobId.toString(),
                senderId: senderId?.toString()
            }
        );

        res.status(201).json({ success: true, message: populatedMessage });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to send message', error });
    }
};
