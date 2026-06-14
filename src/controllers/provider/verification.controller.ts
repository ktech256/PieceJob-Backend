import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Provider from '../../models/Provider';
import VerificationRequest from '../../models/VerificationRequest';
import * as verificationService from '../../services/verification.service';

import Service, { ServiceCategory, VerificationLevel } from '../../models/Service';

export const getMyStatus = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const latestRequest = await VerificationRequest.findOne({ providerId: provider._id })
            .sort({ submittedAt: -1 });

        res.status(200).json({
            success: true,
            data: {
                currentLevel: provider.verificationLevel,
                currentStatus: provider.verificationStatus,
                latestRequest
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch status', error });
    }
};

export const getRequirements = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const latestRequest = await VerificationRequest.findOne({ providerId: provider._id })
            .sort({ submittedAt: -1 });

        // Consider both active and pending services for dynamic requirement generation
        const combinedServiceCodes = [...new Set([...provider.servicesOffered, ...provider.pendingServices])];
        const services = await Service.find({ code: { $in: combinedServiceCodes } });

        // 1. Determine Activated Levels (Strictly Cumulative Hierarchy)
        const levelOrder = [VerificationLevel.STANDARD, VerificationLevel.PROFESSIONAL, VerificationLevel.TRADE, VerificationLevel.HIGH_VETTING];
        const activeLevels = new Set([VerificationLevel.STANDARD]);

        let highestLevelIndex = 0;

        for (const s of services) {
            let level = s.verificationLevel;

            // Respect Dashboard settings strictly (RC-2 Fix)
            const currentIdx = levelOrder.indexOf(level);
            if (currentIdx > highestLevelIndex) highestLevelIndex = currentIdx;
        }

        // Fill additive hierarchy
        for (let i = 0; i <= highestLevelIndex; i++) {
            activeLevels.add(levelOrder[i]);
        }

        // 2. Build Document List dynamically based on active levels
        const requirements: { type: string, isRequired: boolean, allowedTypes: string[], label: string, group: string, status: string, rejectionReason?: string }[] = [];

        // Fetch provider's permanent document records
        const permanentDocs = provider.documents || [];

        const getDocStatus = (type: string) => {
            const perm = permanentDocs.find((d: any) => d.type === type);
            if (perm && perm.status === 'APPROVED') return 'VERIFIED';
            if (perm && perm.status === 'REJECTED') return 'REJECTED';

            const latest = latestRequest?.documents?.find((d: any) => d.type === type);
            if (latest) {
                if (latest.status === 'APPROVED') return 'VERIFIED';
                if (latest.status === 'REJECTED') return 'REJECTED';
                return 'PENDING REVIEW';
            }
            return 'NOT UPLOADED';
        };

        const getRejectionReason = (type: string) => {
            const perm = permanentDocs.find((d: any) => d.type === type);
            if (perm && perm.status === 'REJECTED') return perm.rejectionReason;

            const latest = latestRequest?.documents?.find((d: any) => d.type === type);
            return latest?.rejectionReason;
        };

        // --- STANDARD ---
        requirements.push({
            type: 'GOVERNMENT_ID',
            isRequired: true,
            allowedTypes: ['CAMERA', 'GALLERY', 'PDF'],
            label: 'Government ID',
            group: 'STANDARD',
            status: getDocStatus('GOVERNMENT_ID'),
            rejectionReason: getRejectionReason('GOVERNMENT_ID')
        });
        requirements.push({
            type: 'SELFIE',
            isRequired: true,
            allowedTypes: ['CAMERA', 'GALLERY'],
            label: 'Selfie',
            group: 'STANDARD',
            status: getDocStatus('SELFIE'),
            rejectionReason: getRejectionReason('SELFIE')
        });

        // CRIMINAL CHECK ENGINE (HURU)
        // Only show Criminal Check if triggered OR if higher level than STANDARD is active
        const isProfessionalPlus = highestLevelIndex > 0;

        // Triggered if (rated and rating low) OR verified complaints OR manual admin flag
        const isTriggered = (provider.jobsCompleted > 0 && provider.ratingAvg < 3.5) ||
                           provider.performance.complaintsCount > 0 ||
                           provider.criminalCheckRequired;

        const isCriminalCheckMandatory = isProfessionalPlus || isTriggered;

        // RC-2: Respect Criminal Check visibility rule - strictly hide for standard unless triggered
        if (isCriminalCheckMandatory) {
            requirements.push({
                type: 'CRIMINAL_CHECK',
                isRequired: true,
                allowedTypes: ['GALLERY', 'PDF'],
                label: 'Criminal Check (Mandatory)',
                group: 'STANDARD',
                status: getDocStatus('CRIMINAL_CHECK'),
                rejectionReason: getRejectionReason('CRIMINAL_CHECK')
            });
        }

        // --- PROFESSIONAL ---
        if (activeLevels.has(VerificationLevel.PROFESSIONAL)) {
            requirements.push({
                type: 'CERTIFICATION',
                isRequired: true,
                allowedTypes: ['GALLERY', 'PDF'],
                label: 'Certification',
                group: 'PROFESSIONAL',
                status: getDocStatus('CERTIFICATION'),
                rejectionReason: getRejectionReason('CERTIFICATION')
            });
            requirements.push({
                type: 'EXPERIENCE_VERIFICATION',
                isRequired: true,
                allowedTypes: ['GALLERY', 'PDF'],
                label: 'Experience Verification',
                group: 'PROFESSIONAL',
                status: getDocStatus('EXPERIENCE_VERIFICATION'),
                rejectionReason: getRejectionReason('EXPERIENCE_VERIFICATION')
            });
        }

        // --- TRADE ---
        if (activeLevels.has(VerificationLevel.TRADE)) {
            requirements.push({
                type: 'TRADE_LICENSE',
                isRequired: true,
                allowedTypes: ['GALLERY', 'PDF'],
                label: 'Trade Licence',
                group: 'TRADE',
                status: getDocStatus('TRADE_LICENSE'),
                rejectionReason: getRejectionReason('TRADE_LICENSE')
            });
            requirements.push({
                type: 'TOOL_VERIFICATION',
                isRequired: true,
                allowedTypes: ['CAMERA', 'GALLERY'],
                label: 'Tool Verification',
                group: 'TRADE',
                status: getDocStatus('TOOL_VERIFICATION'),
                rejectionReason: getRejectionReason('TOOL_VERIFICATION')
            });
        }

        // --- HIGH VETTING ---
        if (activeLevels.has(VerificationLevel.HIGH_VETTING)) {
            requirements.push({
                type: 'INTERVIEW',
                isRequired: true,
                allowedTypes: ['NONE'],
                label: 'Interview',
                group: 'HIGH_VETTING',
                status: getDocStatus('INTERVIEW')
            });
            requirements.push({
                type: 'REFERENCES',
                isRequired: true,
                allowedTypes: ['NONE'],
                label: 'References',
                group: 'HIGH_VETTING',
                status: getDocStatus('REFERENCES')
            });
        }

        res.status(200).json({
            success: true,
            data: {
                currentLevel: provider.verificationLevel,
                targetLevel: levelOrder[highestLevelIndex],
                verificationStatus: provider.verificationStatus,
                activeLevels: Array.from(activeLevels),
                requirements
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch requirements', error });
    }
};

export const submitMyVerification = async (req: AuthRequest, res: Response) => {
    try {
        const { type, documents, extraData } = req.body;

        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const result = await verificationService.submitVerification(
            provider._id.toString(),
            type,
            documents,
            provider.countryCode,
            extraData
        );

        res.status(201).json({
            success: true,
            data: result
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
