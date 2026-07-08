import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth.middleware';
import Message from '../../models/Chat';
import Call from '../../models/Call';
import Review from '../../models/Review';
import Job from '../../models/Job';
import Dispute from '../../models/Dispute';

export const listAllChats = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, countryCode, startDate, endDate, customerName, providerName, jobStatus, messageContent, serviceCode } = req.query;
        const query: any = {};

        if (jobId) query.jobId = new mongoose.Types.ObjectId(jobId as string);
        if (messageContent) query.text = { $regex: messageContent, $options: 'i' };

        // Date Range
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate as string);
            if (endDate) query.createdAt.$lte = new Date(endDate as string);
        }

        // Complex filters requiring Job join
        const jobMatch: any = {};
        if (countryCode && countryCode !== 'GLOBAL') jobMatch['job.countryCode'] = countryCode;
        if (jobStatus) jobMatch['job.status'] = jobStatus;
        if (serviceCode) jobMatch['job.serviceCode'] = serviceCode;

        const chats = await Message.aggregate([
            { $match: query },
            { $sort: { createdAt: -1 } },
            { $group: {
                _id: "$jobId",
                lastMessage: { $first: "$$ROOT" },
                messageCount: { $sum: 1 }
            }},
            { $lookup: {
                from: 'jobs',
                localField: '_id',
                foreignField: '_id',
                as: 'job'
            }},
            { $unwind: '$job' },
            { $match: jobMatch }, // Apply job-level filters with correct nested paths
            { $lookup: {
                from: 'users',
                localField: 'job.customerId',
                foreignField: '_id',
                as: 'customer'
            }},
            { $unwind: '$customer' },
            { $lookup: {
                from: 'users',
                localField: 'job.providerId',
                foreignField: '_id',
                as: 'provider'
            }},
            { $unwind: { path: '$provider', preserveNullAndEmptyArrays: true } }
        ]);

        res.status(200).json({ success: true, data: chats });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list chats', error });
    }
};

export const listAllCalls = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, countryCode, startDate, endDate, jobStatus, callStatus, minDuration, maxDuration, serviceCode } = req.query;
        const query: any = {};

        if (jobId) query.jobId = jobId;
        if (callStatus) query.status = callStatus;
        if (minDuration || maxDuration) {
            query.duration = {};
            if (minDuration) query.duration.$gte = Number(minDuration);
            if (maxDuration) query.duration.$lte = Number(maxDuration);
        }

        if (startDate || endDate) {
            query.startTime = {};
            if (startDate) query.startTime.$gte = new Date(startDate as string);
            if (endDate) query.startTime.$lte = new Date(endDate as string);
        }

        const jobQuery: any = {};
        if (countryCode && countryCode !== 'GLOBAL') jobQuery.countryCode = countryCode;
        if (jobStatus) jobQuery.status = jobStatus;
        if (serviceCode) jobQuery.serviceCode = serviceCode;

        const calls = await Call.find(query)
            .sort({ createdAt: -1 })
            .populate('callerId', 'firstName lastName role profilePicture')
            .populate('receiverId', 'firstName lastName role profilePicture')
            .populate({
                path: 'jobId',
                match: Object.keys(jobQuery).length > 0 ? jobQuery : undefined,
                select: 'serviceCode countryCode status location pickupLocation distanceTravelled acceptedAt startedAt completedAt createdAt'
            });

        // Filter out calls where job didn't match (if any job filters applied)
        const filteredCalls = Object.keys(jobQuery).length > 0 ? calls.filter(c => c.jobId !== null) : calls;

        res.status(200).json({ success: true, data: filteredCalls });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list calls', error });
    }
};

export const listAllReviews = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, countryCode, reviewerRole, startDate, endDate, rating, jobStatus, serviceCode } = req.query;
        const query: any = {};

        if (jobId) query.jobId = jobId;
        if (reviewerRole) query.reviewerRole = reviewerRole;
        if (rating) query.rating = Number(rating);

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate as string);
            if (endDate) query.createdAt.$lte = new Date(endDate as string);
        }

        const jobQuery: any = {};
        if (countryCode && countryCode !== 'GLOBAL') jobQuery.countryCode = countryCode;
        if (jobStatus) jobQuery.status = jobStatus;
        if (serviceCode) jobQuery.serviceCode = serviceCode;

        const reviews = await Review.find(query)
            .sort({ createdAt: -1 })
            .populate('reviewerId', 'firstName lastName role profilePicture')
            .populate('reviewedUserId', 'firstName lastName role profilePicture')
            .populate({
                path: 'jobId',
                match: Object.keys(jobQuery).length > 0 ? jobQuery : undefined,
                select: 'serviceCode status location pickupLocation distanceTravelled acceptedAt startedAt completedAt createdAt customerId providerId',
                populate: [
                    { path: 'customerId', select: 'firstName lastName profilePicture' },
                    { path: 'providerId', select: 'firstName lastName profilePicture' }
                ]
            });

        const filteredReviews = Object.keys(jobQuery).length > 0 ? reviews.filter(r => r.jobId !== null) : reviews;

        res.status(200).json({ success: true, data: filteredReviews });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list reviews', error });
    }
};

export const listAllDisputes = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, countryCode, status, jobStatus, startDate, endDate, serviceCode } = req.query;
        const query: any = {};

        if (jobId) query.jobId = jobId;
        if (status) query.status = status;
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate as string);
            if (endDate) query.createdAt.$lte = new Date(endDate as string);
        }

        const jobQuery: any = {};
        if (jobStatus) jobQuery.status = jobStatus;
        if (serviceCode) jobQuery.serviceCode = serviceCode;

        const disputes = await Dispute.find(query)
            .sort({ createdAt: -1 })
            .populate('raisedBy', 'firstName lastName role profilePicture')
            .populate({
                path: 'jobId',
                match: Object.keys(jobQuery).length > 0 ? jobQuery : undefined,
                select: 'serviceCode status location pickupLocation distanceTravelled acceptedAt startedAt completedAt createdAt customerId providerId',
                populate: [
                    { path: 'customerId', select: 'firstName lastName profilePicture' },
                    { path: 'providerId', select: 'firstName lastName profilePicture' }
                ]
            });

        const filteredDisputes = Object.keys(jobQuery).length > 0 ? disputes.filter(d => d.jobId !== null) : disputes;

        res.status(200).json({ success: true, data: filteredDisputes });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list disputes', error });
    }
};
