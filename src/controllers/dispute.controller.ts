import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Dispute, { DisputeStatus } from '../models/Dispute';
import Job, { JobStatus } from '../models/Job';
import Provider from '../models/Provider';
import AuditLog from '../models/AuditLog';

export const raiseDispute = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId, reason, description, evidenceUrls } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const dispute = new Dispute({
      jobId,
      raisedBy: req.user?.userId,
      reason,
      description,
      evidenceUrls,
      countryCode: req.user?.countryCode
    });

    await dispute.save();

    // Lock job for investigation
    job.status = JobStatus.DISPUTED;
    await job.save();

    // PAGE 7: Increment Provider Complaints if customer raised it
    if (req.user?.role === 'CUSTOMER' && job.providerId) {
        await Provider.findOneAndUpdate(
            { userId: job.providerId },
            { $inc: { 'performance.complaintsCount': 1 } }
        );
    }

    res.status(201).json({ success: true, data: { disputeId: dispute.id } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to raise dispute', error });
  }
};

export const getDisputes = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode, status } = req.query;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
    if (status) query.status = status;

    const disputes = await Dispute.find(query)
      .populate('raisedBy', 'firstName lastName role profilePicture')
      .populate({
        path: 'jobId',
        populate: [
            { path: 'customerId', select: 'firstName lastName profilePicture' },
            { path: 'providerId', select: 'firstName lastName profilePicture' }
        ]
      })
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: disputes });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch disputes', error });
  }
};

export const getMyDisputes = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        // Find disputes where the provider is either the one who raised it, or the provider on the job
        const jobs = await Job.find({ providerId: userId });
        const jobIds = jobs.map(j => j._id);

        const disputes = await Dispute.find({
            $or: [
                { raisedBy: userId },
                { jobId: { $in: jobIds } }
            ]
        }).sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: disputes });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch your disputes', error });
    }
};

export const updateDisputeStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { disputeId } = req.params;
    const { status, adminNotes, resolution } = req.body;

    const dispute = await Dispute.findById(disputeId);
    if (!dispute) return res.status(404).json({ success: false, message: 'Dispute not found' });

    const previousStatus = dispute.status;
    dispute.status = status;
    if (adminNotes) dispute.adminNotes = adminNotes;
    if (resolution) dispute.resolution = resolution;
    if (status === DisputeStatus.RESOLVED) dispute.resolvedAt = new Date();

    await dispute.save();

    // Audit Log
    await AuditLog.create({
      adminId: req.user?.userId,
      action: 'DISPUTE_UPDATE',
      targetId: disputeId,
      targetCollection: 'Disputes',
      previousValue: { status: previousStatus },
      newValue: { status, resolution },
      ipAddress: req.ip
    });

    res.status(200).json({ success: true, data: dispute });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed', error });
  }
};
