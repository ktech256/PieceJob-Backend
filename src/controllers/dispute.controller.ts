import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Dispute, { DisputeStatus } from '../models/Dispute';
import Job, { JobStatus } from '../models/Job';
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

    res.status(201).json({ success: true, disputeId: dispute.id });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to raise dispute', error });
  }
};

export const getDisputes = async (req: AuthRequest, res: Response) => {
  try {
    const disputes = await Dispute.find({ countryCode: req.user?.countryCode })
      .populate('raisedBy', 'firstName lastName role')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, disputes });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch disputes', error });
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

    res.status(200).json({ success: true, dispute });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed', error });
  }
};
