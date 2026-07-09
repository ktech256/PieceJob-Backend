import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Message from '../models/Chat';
import Job from '../models/Job';
import User, { UserRole } from '../models/User';
import Country from '../models/Country';
import * as notificationService from '../services/notification.service';
import * as storageService from '../services/storage.service';
import { emitToUser, emitJobUpdate } from '../socket/socket.service';
import { formatToWorkspaceTime } from '../utils/date';

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

        const country = await Country.findOne({ code: job.countryCode });
        const tz = country?.timezone || 'UTC';

        const messages = await Message.find({ jobId })
            .sort({ createdAt: 1 })
            .populate('senderId', 'firstName lastName role profilePhoto');

        // Map profilePhoto to profilePicture for Android
        const data = await Promise.all(messages.map(async (m) => {
            const obj: any = m.toObject();
            obj.createdAt = formatToWorkspaceTime(obj.createdAt, tz);

            if (obj.senderId && typeof obj.senderId === 'object') {
                if (obj.senderId.profilePhoto) {
                    obj.senderId.profilePicture = await storageService.getSignedUrl(obj.senderId.profilePhoto);
                }
            }

            // Enrich metadata photos with signed URLs
            if (obj.metadata && obj.metadata.type === 'PHOTO_UPLOAD' && Array.isArray(obj.metadata.allPhotos)) {
                obj.metadata.allPhotos = await Promise.all(obj.metadata.allPhotos.map(async (path: string) => {
                    return await storageService.getSignedUrl(path);
                }));
                // Also sign preview mediaUrl
                if (obj.mediaUrl) {
                    obj.mediaUrl = await storageService.getSignedUrl(obj.mediaUrl);
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
        const countryCode = req.user?.countryCode;
        const country = await Country.findOne({ code: countryCode });
        const tz = country?.timezone || 'UTC';

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
                lastMessageTimeRaw: lastMessage?.createdAt || job.updatedAt,
                unreadCount: await Message.countDocuments({ jobId: job._id, receiverId: userId, isRead: false })
            };
        }));

        conversations.sort((a, b) => b.lastMessageTimeRaw.getTime() - a.lastMessageTimeRaw.getTime());

        const data = conversations.map(conv => ({
            ...conv,
            lastMessageTime: formatToWorkspaceTime(conv.lastMessageTimeRaw, tz),
            lastMessageTimeRaw: undefined // Remove raw date before sending to client
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch conversations', error });
    }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, receiverId, text, mediaUrl, mediaType, metadata } = req.body;
        const senderId = req.user?.userId;

        // Validate participants
        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const terminalStatuses = ['COMPLETED', 'CANCELLED', 'RATED', 'CLOSED'];
        if (terminalStatuses.includes(job.status)) {
            return res.status(403).json({ success: false, message: `Chat is disabled for a ${job.status} job` });
        }

        // PHASE 3 & 11: Negotiation Messaging Lockdown
        // Only structured messages (with metadata.type) are allowed during PROVIDER_ACCEPTED state
        const isNegotiationPhase = job.status === 'PROVIDER_ACCEPTED';
        const isStructured = metadata && metadata.type;

        if (isNegotiationPhase && !isStructured) {
            return res.status(403).json({
                success: false,
                message: 'Free-text messaging is disabled during negotiation. Please use structured actions.'
            });
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
            mediaType,
            metadata
        });

        console.log(`[FORENSIC] BACKEND_CHAT_RECEIVED | Job: ${jobId} | From: ${senderId} | To: ${receiverId}`);

        await message.save();
        console.log(`[FORENSIC] CHAT_DATABASE_SAVE | Message: ${message._id}`);

        const country = await Country.findOne({ code: job.countryCode });
        const tz = country?.timezone || 'UTC';

        const populatedMessage = await Message.findById(message._id).populate('senderId', 'firstName lastName role profilePhoto');

        const data: any = populatedMessage?.toObject();
        if (data) {
            data.id = data._id?.toString();
            data.jobId = data.jobId?.toString();
            data.senderId._id = data.senderId._id?.toString();
            data.receiverId = data.receiverId?.toString();
            data.createdAt = formatToWorkspaceTime(data.createdAt, tz);
            if (data.senderId && typeof data.senderId === 'object') {
                data.senderId.profilePicture = data.senderId.profilePhoto;
            }
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

export const requestTaskPhotos = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const providerId = req.user?.userId;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        if (job.providerId?.toString() !== providerId) {
            return res.status(403).json({ success: false, message: 'Only the assigned provider can request photos' });
        }

        job.taskPhotosRequested = true;
        job.taskPhotosRequestedAt = new Date();
        await job.save();

        // Send a structured message in chat
        const message = new Message({
            jobId,
            senderId: providerId,
            receiverId: job.customerId,
            text: 'Provider requested photos for this task.',
            metadata: { type: 'PHOTO_REQUEST' }
        });
        await message.save();

        const populated = await Message.findById(message._id).populate('senderId', 'firstName lastName role profilePhoto');
        const data: any = populated?.toObject();
        if (data) {
            data.id = data._id?.toString();
            data.jobId = data.jobId?.toString();
            if (data.senderId && typeof data.senderId === 'object') {
                data.senderId.profilePicture = data.senderId.profilePhoto;
            }
        }
        emitJobUpdate(jobId, 'new_message', data);

        await notificationService.notifyUser(
            job.customerId.toString(),
            'Task Photos Requested',
            'Your provider has requested photos of the task for a better estimation.',
            { type: 'PHOTO_REQUEST', jobId: jobId.toString() }
        );

        res.status(200).json({ success: true, message: 'Photos requested successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to request photos', error });
    }
};
