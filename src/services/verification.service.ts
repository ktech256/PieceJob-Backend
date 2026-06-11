import mongoose from 'mongoose';
import VerificationRequest, { VerificationRequestStatus } from '../models/VerificationRequest';
import Provider from '../models/Provider';
import { VerificationLevel } from '../models/Service';
import AuditLog, { AuditType } from '../models/AuditLog';
import { notifyUser } from './notification.service';
import * as auditService from './audit.service';

export const submitVerification = async (
    providerId: string,
    type: VerificationLevel,
    documents: any[],
    countryCode: string,
    extraData: any = {}
) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // 1. Check for existing pending request of same type
        const existing = await VerificationRequest.findOne({
            providerId,
            type,
            status: { $in: [VerificationRequestStatus.PENDING, VerificationRequestStatus.UNDER_REVIEW] }
        }).session(session);

        if (existing) throw new Error(`A verification request for ${type} is already in progress.`);

        // 2. Create Request
        const request = new VerificationRequest({
            providerId,
            countryCode,
            type,
            documents: documents.map(d => ({ ...d, status: 'PENDING' })),
            ...extraData,
            status: VerificationRequestStatus.PENDING,
            submittedAt: new Date()
        });

        await request.save({ session });

        // 3. Update Provider Status
        await Provider.findByIdAndUpdate(providerId, {
            verificationStatus: 'PENDING'
        }).session(session);

        await session.commitTransaction();
        return request;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

export const reviewRequest = async (
    requestId: string,
    adminId: string,
    status: VerificationRequestStatus,
    rejectionReason?: string,
    documentStatusUpdates?: { docId: string, status: 'APPROVED' | 'REJECTED', reason?: string }[]
) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const request = await VerificationRequest.findById(requestId).session(session);
        if (!request) throw new Error('Request not found');

        const oldStatus = request.status;
        request.status = status;
        request.reviewedBy = adminId as any;
        request.reviewedAt = new Date();
        if (rejectionReason) request.rejectionReason = rejectionReason;

        // PAGE 8 Section 6: Double Approval for HIGH VETTING
        if (request.type === VerificationLevel.HIGH_VETTING && status === VerificationRequestStatus.APPROVED) {
            if (!request.approvalControls?.officerApproved) {
                request.approvalControls = { ...request.approvalControls, officerApproved: true, officerId: adminId as any };
                request.status = VerificationRequestStatus.UNDER_REVIEW; // Keep in queue for supervisor
            } else if (!request.approvalControls?.supervisorApproved) {
                request.approvalControls = { ...request.approvalControls, supervisorApproved: true, supervisorId: adminId as any };
                request.status = VerificationRequestStatus.APPROVED;
            }
        }

        if (documentStatusUpdates) {
            documentStatusUpdates.forEach(update => {
                const doc = (request.documents as any).id(update.docId);
                if (doc) {
                    doc.status = update.status;
                    doc.rejectionReason = update.reason;
                }
            });
        }

        await request.save({ session });

        // If Approved, upgrade provider level
        if (request.status === VerificationRequestStatus.APPROVED) {
            const provider = await Provider.findById(request.providerId).session(session);
            if (provider) {
                provider.verificationLevel = request.type;
                provider.verificationStatus = 'APPROVED';
                await provider.save({ session });
            }
        } else if (status === VerificationRequestStatus.REJECTED) {
             await Provider.findByIdAndUpdate(request.providerId, {
                verificationStatus: 'REJECTED'
            }).session(session);
        }

        // 3. New Unified Audit Logging
        const admin = await mongoose.model('User').findById(adminId);
        await auditService.logAdminAction({
            countryCode: request.countryCode,
            adminId,
            adminRole: admin?.role || 'ADMIN',
            action: 'VERIFICATION_REVIEW',
            entityType: 'VerificationRequest',
            entityId: requestId,
            beforeState: { status: oldStatus },
            afterState: { status, rejectionReason },
            systemSource: 'ADMIN_DASHBOARD'
        });

        await session.commitTransaction();

        // Notify Provider
        const provider = await Provider.findById(request.providerId).populate('userId');
        if (provider && (provider.userId as any)._id) {
            await notifyUser(
                (provider.userId as any)._id.toString(),
                `Verification ${status}`,
                status === VerificationRequestStatus.APPROVED
                    ? `Your ${request.type} verification has been approved.`
                    : `Your ${request.type} verification was rejected: ${rejectionReason}`,
                { type: 'VERIFICATION_UPDATE', requestId, status }
            );
        }

        return request;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};
