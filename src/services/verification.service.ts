import mongoose from 'mongoose';
import VerificationRequest, { VerificationRequestStatus } from '../models/VerificationRequest';
import Provider, { VerificationStatus } from '../models/Provider';
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
        const latestRequest = await VerificationRequest.findOne({
            providerId,
            type
        }).sort({ submittedAt: -1 }).session(session);

        console.log(`[VERIFY_LOCK] Provider: ${providerId}, Level: ${type}, Latest Status: ${latestRequest?.status}`);

        if (latestRequest &&
           (latestRequest.status === VerificationRequestStatus.PENDING ||
            latestRequest.status === VerificationRequestStatus.UNDER_REVIEW)) {
            console.error(`[VERIFY_LOCK] Submission blocked. Active request ${latestRequest._id} is in status ${latestRequest.status}`);
            throw new Error(`A verification request for ${type} is already in progress.`);
        }

        const provider = await Provider.findById(providerId).session(session);
        if (!provider) throw new Error('Provider not found');

        // Merge incoming documents with existing approved ones to ensure a complete set for review
        const finalDocs = [...documents.map(d => ({
            ...d,
            status: d.status === 'APPROVED' ? 'APPROVED' : 'PENDING'
        }))];

        provider.documents.forEach(permDoc => {
            if (permDoc.status === 'APPROVED') {
                const alreadyInIncoming = finalDocs.find(d => d.type === permDoc.type);
                if (!alreadyInIncoming) {
                    finalDocs.push({
                        type: permDoc.type,
                        url: permDoc.url,
                        status: 'APPROVED'
                    });
                }
            }
        });

        // 2. Create Request
        const request = new VerificationRequest({
            providerId,
            countryCode,
            type,
            documents: finalDocs,
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
            const controls = request.approvalControls || { officerApproved: false, supervisorApproved: false };
            if (!controls.officerApproved) {
                request.approvalControls = { ...controls, officerApproved: true, officerId: adminId as any };
                request.status = VerificationRequestStatus.UNDER_REVIEW; // Keep in queue for supervisor
            } else if (!controls.supervisorApproved) {
                request.approvalControls = { ...controls, supervisorApproved: true, supervisorId: adminId as any };
                request.status = VerificationRequestStatus.APPROVED;
            }
        }

        if (documentStatusUpdates) {
            const provider = await Provider.findById(request.providerId).session(session);

            for (const update of documentStatusUpdates) {
                const doc = (request.documents as any).id(update.docId);
                if (doc) {
                    const oldDocStatus = doc.status;
                    doc.status = update.status;
                    doc.rejectionReason = update.reason;

                    if (provider) {
                        // Sync to permanent records
                        const existingIdx = provider.documents.findIndex(d => d.type === doc.type);
                        if (existingIdx !== -1) {
                            provider.documents[existingIdx].url = doc.url;
                            provider.documents[existingIdx].status = update.status as any;
                            if (update.reason) provider.documents[existingIdx].rejectionReason = update.reason;
                        } else {
                            provider.documents.push({
                                type: doc.type,
                                url: doc.url,
                                status: update.status as any,
                                rejectionReason: update.reason
                            });
                        }

                        // Notification for specific document change
                        if (oldDocStatus !== update.status && provider.userId) {
                            const title = update.status === 'APPROVED' ? 'Document Approved' : 'Document Rejected';
                            const body = update.status === 'APPROVED'
                                ? `Your ${doc.type.replace(/_/g, ' ')} has been approved.`
                                : `Your ${doc.type.replace(/_/g, ' ')} was rejected: ${update.reason || 'Please resubmit.'}`;

                            // Non-blocking notification
                            notifyUser(provider.userId.toString(), title, body, {
                                type: 'VERIFICATION_UPDATE',
                                docType: doc.type,
                                status: update.status
                            }).catch(e => console.error('Notification failed', e));
                        }
                    }
                }
            }

            if (provider) await provider.save({ session });
        }

        await request.save({ session });

        // If Approved, upgrade provider level
        if (request.status === VerificationRequestStatus.APPROVED) {
            const provider = await Provider.findById(request.providerId).session(session);
            if (provider) {
                provider.verificationLevel = request.type;
                provider.verificationStatus = VerificationStatus.APPROVED;

                // SPEC: Approved Selfie automatically becomes Provider Profile Picture
                const selfie = request.documents.find(d => d.type === 'SELFIE' && d.status === 'APPROVED');
                if (selfie) {
                    await mongoose.model('User').findByIdAndUpdate(provider.userId, {
                        profilePhoto: selfie.url
                    }).session(session);
                }

                await provider.save({ session });
            }
        } else if (status === VerificationRequestStatus.REJECTED || status === VerificationRequestStatus.ACTION_REQUIRED) {
             await Provider.findByIdAndUpdate(request.providerId, {
                verificationStatus: status === VerificationRequestStatus.REJECTED ? VerificationStatus.REJECTED : VerificationStatus.ACTION_REQUIRED
            }).session(session);
        } else if (status === VerificationRequestStatus.RESUBMITTED) {
            await Provider.findByIdAndUpdate(request.providerId, {
                verificationStatus: 'PENDING'
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
                `Verification ${status === VerificationRequestStatus.RESUBMITTED ? 'Resubmission Required' : status}`,
                status === VerificationRequestStatus.APPROVED
                    ? `Your ${request.type} verification has been approved.`
                    : status === VerificationRequestStatus.RESUBMITTED
                        ? `A document in your ${request.type} verification requires resubmission: ${rejectionReason}`
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
