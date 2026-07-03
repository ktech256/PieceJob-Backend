import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Message from '../models/Chat';
import Job from '../models/Job';
import User, { UserRole } from '../models/User';
import * as notificationService from '../services/notification.service';
import * as storageService from '../services/storage.service';
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
            .populate('senderId', 'firstName lastName role profilePhoto');

        // Map profilePhoto to profilePicture for Android
        const data = await Promise.all(messages.map(async (m) => {
            const obj: any = m.toObject();
            if (obj.senderId && typeof obj.senderId === 'object') {
                if (obj.senderId.profilePhoto) {
                    obj.senderId.profilePicture = await storageService.getSignedUrl(obj.senderId.profilePhoto);
                }
            }
            return obj;
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch messages', error });
    }
};

export const getConversations = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        // Find all jobs where this user is a participant
        const jobs = await Job.find({
            $or: [{ customerId: userId }, { providerId: userId }],
            status: { $nin: ['DRAFT', 'REQUEST_CREATED', 'PAYMENT_PENDING', 'BROADCASTED'] }
        }).populate('customerId', 'firstName lastName profilePhoto')
          .populate('providerId', 'firstName lastName profilePhoto');

        const conversations = await Promise.all(jobs.map(async (job) => {
            const lastMessage = await Message.findOne({ jobId: job._id })
                .sort({ createdAt: -1 });

            const otherUserRaw: any = job.customerId.toString() === userId ? job.providerId : job.customerId;
            const otherUser: any = (otherUserRaw && typeof otherUserRaw === 'object' && 'toObject' in otherUserRaw)
                ? otherUserRaw.toObject()
                : (otherUserRaw || {});

            if (otherUser && otherUser.profilePhoto) {
                otherUser.profilePicture = await storageService.getSignedUrl(otherUser.profilePhoto);
            }

            return {
                jobId: job._id,
                serviceName: job.serviceName || job.serviceCode,
                status: job.status,
                otherUser: otherUser,
                lastMessage: lastMessage?.text || (lastMessage?.mediaType ? 'Sent an attachment' : 'No messages yet'),
                lastMessageTime: lastMessage?.createdAt || job.updatedAt,
                unreadCount: await Message.countDocuments({ jobId: job._id, receiverId: userId, isRead: false })
            };
        }));

        conversations.sort((a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime());

        res.status(200).json({ success: true, data: conversations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch conversations', error });
    }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, receiverId, text, mediaUrl, mediaType } = req.body;
        const senderId = req.user?.userId;

        // Validate participants
        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const terminalStatuses = ['COMPLETED', 'CANCELLED', 'RATED', 'CLOSED'];
        if (terminalStatuses.includes(job.status)) {
            return res.status(403).json({ success: false, message: `Chat is disabled for a ${job.status} job` });
        }

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

        console.log(`[FORENSIC] BACKEND_CHAT_RECEIVED | Job: ${jobId} | From: ${senderId} | To: ${receiverId}`);

        await message.save();
        console.log(`[FORENSIC] CHAT_DATABASE_SAVE | Message: ${message._id}`);

        const populatedMessage = await Message.findById(message._id).populate('senderId', 'firstName lastName role profilePhoto');

        const data = populatedMessage?.toObject();
        if (data && data.senderId && typeof data.senderId === 'object') {
            (data.senderId as any).profilePicture = (data.senderId as any).profilePhoto;
        }

        // 1. Emit via Socket to Job Room (for live updates in Chat Screen)
        console.log(`[FORENSIC] CHAT_SOCKET_EMIT | Room: job_${jobId}`);
        emitJobUpdate(jobId, 'new_message', data);

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

        res.status(201).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to send message', error });
    }
};
