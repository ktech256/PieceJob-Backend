import mongoose from 'mongoose';
import VerificationRequest, { VerificationRequestStatus } from '../models/VerificationRequest';
import Provider, { VerificationStatus } from '../models/Provider';
import { VerificationLevel } from '../models/Service';
import AuditLog, { AuditType } from '../models/AuditLog';
import { notifyUser } from './notification.service';
import * as auditService from './audit.service';
import { logger } from '../utils/logger';

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
        // 1. Get the latest request for this level to check for locks and merge documents
        const latestRequest = await VerificationRequest.findOne({
            providerId,
            type
        }).sort({ submittedAt: -1 }).session(session);

        logger.debug(`VERIFY | SUBMIT | Provider: ${providerId} | Level: ${type} | Docs: ${documents.length}`);

        if (latestRequest &&
           (latestRequest.status === VerificationRequestStatus.PENDING ||
            latestRequest.status === VerificationRequestStatus.UNDER_REVIEW)) {

            const hasRejectedDocs = latestRequest.documents.some(d => d.status === 'REJECTED');
            const isPurePending = latestRequest.status === VerificationRequestStatus.PENDING && !hasRejectedDocs;

            // Only block if it's a completely new, untouched request.
            // If there's any rejection or it's already under review with rejections, allow resubmission.
            if (isPurePending) {
                logger.warn(`VERIFY | LOCKED | Provider: ${providerId} | Request in progress.`);
                throw new Error(`A verification request for ${type} is already in progress.`);
            } else {
                 logger.debug(`VERIFY | SUPERSEDE | request ${latestRequest._id}`);
                 // Mark old request as superseded/resubmitted
                 latestRequest.status = VerificationRequestStatus.RESUBMITTED;
                 await latestRequest.save({ session });
            }
        }

        const provider = await Provider.findById(providerId).session(session);
        if (!provider) throw new Error('Provider not found');

        // --- SMART MERGE LOGIC ---
        // Ensure the new request is a COMPLETE set for the level.
        // If a document type is missing from the incoming set, pull it from the latest request or profile.

        const finalDocs = [...documents.map(d => ({
            ...d,
            status: d.status === 'APPROVED' ? 'APPROVED' : 'PENDING'
        }))];

        const existingDocTypes = new Set(finalDocs.map(d => d.type));

        // Pull missing docs from latest request to maintain a full set for the admin
        if (latestRequest) {
            latestRequest.documents.forEach(prevDoc => {
                if (!existingDocTypes.has(prevDoc.type)) {
                    finalDocs.push({
                        type: prevDoc.type,
                        url: prevDoc.url,
                        status: prevDoc.status as any,
                        rejectionReason: prevDoc.rejectionReason
                    });
                    existingDocTypes.add(prevDoc.type);
                }
            });
        }

        // Also check permanent records for anything still missing (e.g. legacy approvals)
        provider.documents.forEach(permDoc => {
            if (!existingDocTypes.has(permDoc.type)) {
                finalDocs.push({
                    type: permDoc.type,
                    url: permDoc.url,
                    status: permDoc.status as any,
                    rejectionReason: permDoc.rejectionReason
                });
                existingDocTypes.add(permDoc.type);
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
                            provider.documents[existingIdx].rejectionReason = update.reason;
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
                            }).catch(e => logger.error(`VERIFY | NOTIFY_FAILED | Error: ${e.message}`));
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

                // --- SERVICE PROMOTION LOGIC ---
                // Move services from pending to offered if provider now meets the level
                const Service = mongoose.model('Service');
                const pendingServices = await Service.find({ code: { $in: provider.pendingServices } }).session(session);

                const levelOrder = ['STANDARD', 'PROFESSIONAL', 'TRADE', 'HIGH_VETTING'];
                const provLevelIdx = levelOrder.indexOf(provider.verificationLevel);

                const newlyApproved: string[] = [];
                const remainingPending: string[] = [];

                for (const s of pendingServices) {
                    const servLevelIdx = levelOrder.indexOf(s.verificationLevel);
                    if (provLevelIdx >= servLevelIdx) {
                        newlyApproved.push(s.code);
                    } else {
                        remainingPending.push(s.code);
                    }
                }

                if (newlyApproved.length > 0) {
                    provider.servicesOffered = [...new Set([...provider.servicesOffered, ...newlyApproved])];
                    provider.pendingServices = remainingPending;
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
