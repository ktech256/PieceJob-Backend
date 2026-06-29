import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Call, { CallStatus } from '../models/Call';
import Job from '../models/Job';
import User from '../models/User';
import { emitToUser } from '../socket/socket.service';

export const logCallInitiation = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, receiverId } = req.body;
        const callerId = req.user?.userId;

        console.log(`[FORENSIC] BACKEND_CALL_RECEIVED | Job: ${jobId} | From: ${callerId} | To: ${receiverId}`);

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const call = new Call({
            jobId,
            callerId,
            receiverId,
            status: CallStatus.MISSED // Default until updated
        });

        await call.save();
        console.log(`[FORENSIC] CALL_DATABASE_SAVE | Call: ${call._id}`);

        // Optional: Signal receiver via Socket
        const caller = await User.findById(callerId);
        console.log(`[FORENSIC] CALL_SOCKET_EMITTED | To User: ${receiverId} | Call: ${call._id}`);
        emitToUser(receiverId, 'incoming_call_intent', {
            jobId,
            callerId,
            callId: call._id,
            callerName: caller?.firstName,
            callerPhone: caller?.phoneNumber
        });

        res.status(201).json({ success: true, data: { callId: call._id } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to log call', error });
    }
};

export const updateCallStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { callId } = req.params;
        const { status, duration } = req.body;

        const call = await Call.findById(callId);
        if (!call) return res.status(404).json({ success: false, message: 'Call record not found' });

        call.status = status;
        if (duration) call.duration = duration;
        call.endTime = new Date();

        await call.save();
        res.status(200).json({ success: true, data: call });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update call status', error });
    }
};

export const getJobCallHistory = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const calls = await Call.find({ jobId })
            .sort({ createdAt: -1 })
            .populate('callerId', 'firstName lastName')
            .populate('receiverId', 'firstName lastName');

        res.status(200).json({ success: true, data: calls });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch call history', error });
    }
};
