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
            currentLevel: provider.verificationLevel,
            currentStatus: provider.verificationStatus,
            latestRequest
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch status', error });
    }
};

export const getRequirements = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        // Consider both active and pending services for dynamic requirement generation
        const combinedServiceCodes = [...new Set([...provider.servicesOffered, ...provider.pendingServices])];
        const services = await Service.find({ code: { $in: combinedServiceCodes } });

        // 1. Determine Activated Levels (Strictly Cumulative Hierarchy)
        const levelOrder = [VerificationLevel.STANDARD, VerificationLevel.PROFESSIONAL, VerificationLevel.TRADE, VerificationLevel.HIGH_VETTING];
        const activeLevels = new Set([VerificationLevel.STANDARD]);

        let highestLevelIndex = 0;

        for (const s of services) {
            let level = s.verificationLevel;

            // SPEC Category Mappings for dynamic level escalation
            if (s.category === ServiceCategory.CSS) level = VerificationLevel.HIGH_VETTING;
            if ([ServiceCategory.HMS, ServiceCategory.OPS, ServiceCategory.TSS].includes(s.category)) {
                if (levelOrder.indexOf(level) < levelOrder.indexOf(VerificationLevel.TRADE)) {
                    level = VerificationLevel.TRADE;
                }
            }

            const currentIdx = levelOrder.indexOf(level);
            if (currentIdx > highestLevelIndex) highestLevelIndex = currentIdx;
        }

        // Fill additive hierarchy
        for (let i = 0; i <= highestLevelIndex; i++) {
            activeLevels.add(levelOrder[i]);
        }

        // 2. Build Document List dynamically based on active levels
        const requirements: { type: string, isRequired: boolean, allowedTypes: string[], label: string, group: string }[] = [];

        // --- STANDARD ---
        requirements.push({ type: 'GOVERNMENT_ID', isRequired: true, allowedTypes: ['CAMERA', 'GALLERY', 'PDF'], label: 'Government ID', group: 'STANDARD' });
        requirements.push({ type: 'SELFIE', isRequired: true, allowedTypes: ['CAMERA', 'GALLERY'], label: 'Selfie', group: 'STANDARD' });

        // CRIMINAL CHECK ENGINE
        const isCriminalCheckMandatory = provider.ratingAvg < 3.5 || provider.performance.complaintsCount > 0 || provider.criminalCheckRequired;
        requirements.push({
            type: 'CRIMINAL_CHECK',
            isRequired: isCriminalCheckMandatory,
            allowedTypes: ['GALLERY', 'PDF'],
            label: isCriminalCheckMandatory ? 'Criminal Check (Mandatory)' : 'Criminal Check (Optional)',
            group: 'STANDARD'
        });

        // --- PROFESSIONAL ---
        if (activeLevels.has(VerificationLevel.PROFESSIONAL)) {
            requirements.push({ type: 'CERTIFICATION', isRequired: true, allowedTypes: ['GALLERY', 'PDF'], label: 'Certification', group: 'PROFESSIONAL' });
            requirements.push({ type: 'EXPERIENCE_VERIFICATION', isRequired: true, allowedTypes: ['GALLERY', 'PDF'], label: 'Experience Verification', group: 'PROFESSIONAL' });
        }

        // --- TRADE ---
        if (activeLevels.has(VerificationLevel.TRADE)) {
            requirements.push({ type: 'TRADE_LICENSE', isRequired: true, allowedTypes: ['GALLERY', 'PDF'], label: 'Trade Licence', group: 'TRADE' });
            requirements.push({ type: 'TOOL_VERIFICATION', isRequired: true, allowedTypes: ['CAMERA', 'GALLERY'], label: 'Tool Verification', group: 'TRADE' });
        }

        // --- HIGH VETTING ---
        if (activeLevels.has(VerificationLevel.HIGH_VETTING)) {
            requirements.push({ type: 'INTERVIEW', isRequired: true, allowedTypes: ['NONE'], label: 'Interview', group: 'HIGH_VETTING' });
            requirements.push({ type: 'REFERENCES', isRequired: true, allowedTypes: ['NONE'], label: 'References', group: 'HIGH_VETTING' });
        }

        res.status(200).json({
            success: true,
            data: {
                currentLevel: provider.verificationLevel,
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

        res.status(201).json({ success: true, request: result });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
