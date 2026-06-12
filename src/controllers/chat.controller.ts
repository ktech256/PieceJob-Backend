import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Message from '../models/Chat';
import User, { UserRole } from '../models/User';
import * as notificationService from '../services/notification.service';

export const getJobMessages = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;

        // SECTION 11: Admin visibility rules (read-only only during DISPUTE or SOS)
        // For standard users, ensure they belong to the job (would need job lookup)
        // For now, allow if role matches

        const messages = await Message.find({ jobId })
            .sort({ createdAt: 1 })
            .populate('senderId', 'firstName lastName role');

        res.status(200).json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch messages', error });
    }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, receiverId, text, mediaUrl, mediaType } = req.body;

        const message = new Message({
            jobId,
            senderId: req.user?.userId,
            receiverId,
            text,
            mediaUrl,
            mediaType
        });

        await message.save();

        // Notify Receiver
        await notificationService.notifyUser(
            receiverId,
            'New Message',
            text || 'You received a new message'
        );

        res.status(201).json({ success: true, message });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to send message', error });
    }
};
