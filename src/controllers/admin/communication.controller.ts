import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Message from '../../models/Chat';
import Call from '../../models/Call';
import Review from '../../models/Review';
import Job from '../../models/Job';

export const listAllChats = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, countryCode } = req.query;
        const query: any = {};

        if (jobId) query.jobId = jobId;

        // If filtering by countryCode, we need to join with Job
        if (countryCode && countryCode !== 'GLOBAL') {
            const jobsInCountry = await Job.find({ countryCode }).select('_id');
            query.jobId = { $in: jobsInCountry.map(j => j._id) };
        }

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

        res.status(200).json({ success: true, chats });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list chats', error });
    }
};

export const listAllCalls = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, countryCode } = req.query;
        const query: any = {};

        if (jobId) query.jobId = jobId;

        if (countryCode && countryCode !== 'GLOBAL') {
            const jobsInCountry = await Job.find({ countryCode }).select('_id');
            query.jobId = { $in: jobsInCountry.map(j => j._id) };
        }

        const calls = await Call.find(query)
            .sort({ createdAt: -1 })
            .populate('callerId', 'firstName lastName role')
            .populate('receiverId', 'firstName lastName role')
            .populate({
                path: 'jobId',
                select: 'serviceCode countryCode'
            });

        res.status(200).json({ success: true, calls });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list calls', error });
    }
};

export const listAllReviews = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, countryCode, reviewerRole } = req.query;
        const query: any = {};

        if (jobId) query.jobId = jobId;
        if (reviewerRole) query.reviewerRole = reviewerRole;

        if (countryCode && countryCode !== 'GLOBAL') {
            const jobsInCountry = await Job.find({ countryCode }).select('_id');
            query.jobId = { $in: jobsInCountry.map(j => j._id) };
        }

        const reviews = await Review.find(query)
            .sort({ createdAt: -1 })
            .populate('reviewerId', 'firstName lastName role')
            .populate('reviewedUserId', 'firstName lastName role')
            .populate({
                path: 'jobId',
                select: 'serviceCode status'
            });

        res.status(200).json({ success: true, reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list reviews', error });
    }
};
