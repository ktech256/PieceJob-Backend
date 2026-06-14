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

        const services = await Service.find({ code: { $in: provider.servicesOffered } });

        // 1. Determine Target Level based on highest service requirement
        let targetLevel = VerificationLevel.STANDARD;
        const levelOrder = [VerificationLevel.STANDARD, VerificationLevel.PROFESSIONAL, VerificationLevel.TRADE, VerificationLevel.HIGH_VETTING];

        for (const s of services) {
            // SPEC: CSS category is HIGH VETTING
            let effectiveLevel = s.verificationLevel;
            if (s.category === ServiceCategory.CSS) effectiveLevel = VerificationLevel.HIGH_VETTING;
            // SPEC: HMS, OPS, TSS categories are TRADE
            if ([ServiceCategory.HMS, ServiceCategory.OPS, ServiceCategory.TSS].includes(s.category)) {
                if (levelOrder.indexOf(effectiveLevel) < levelOrder.indexOf(VerificationLevel.TRADE)) {
                    effectiveLevel = VerificationLevel.TRADE;
                }
            }

            if (levelOrder.indexOf(effectiveLevel) > levelOrder.indexOf(targetLevel)) {
                targetLevel = effectiveLevel;
            }
        }

        // 2. Build Document List
        const requirements: { type: string, isRequired: boolean, allowedTypes: string[], label: string }[] = [];

        // STANDARD
        requirements.push({ type: 'GOVERNMENT_ID', isRequired: true, allowedTypes: ['CAMERA', 'GALLERY', 'PDF'], label: 'Government ID' });
        requirements.push({ type: 'SELFIE', isRequired: true, allowedTypes: ['CAMERA', 'GALLERY'], label: 'Selfie' });

        // CRIMINAL CHECK ENGINE
        const isCriminalCheckMandatory = provider.ratingAvg < 3.5 || provider.performance.complaintsCount > 0 || provider.criminalCheckRequired;
        requirements.push({
            type: 'CRIMINAL_CHECK',
            isRequired: isCriminalCheckMandatory,
            allowedTypes: ['GALLERY', 'PDF'],
            label: isCriminalCheckMandatory ? 'Criminal Check (Mandatory)' : 'Criminal Check (Optional)'
        });

        // PROFESSIONAL
        if (levelOrder.indexOf(targetLevel) >= levelOrder.indexOf(VerificationLevel.PROFESSIONAL)) {
            requirements.push({ type: 'CERTIFICATION', isRequired: true, allowedTypes: ['GALLERY', 'PDF'], label: 'Certification' });
            requirements.push({ type: 'EXPERIENCE_VERIFICATION', isRequired: true, allowedTypes: ['GALLERY', 'PDF'], label: 'Experience Verification' });
        }

        // TRADE
        if (levelOrder.indexOf(targetLevel) >= levelOrder.indexOf(VerificationLevel.TRADE)) {
            requirements.push({ type: 'TRADE_LICENSE', isRequired: true, allowedTypes: ['GALLERY', 'PDF'], label: 'Trade Licence' });
            requirements.push({ type: 'TOOL_VERIFICATION', isRequired: true, allowedTypes: ['CAMERA', 'GALLERY'], label: 'Tool Verification' });
        }

        // HIGH VETTING
        if (levelOrder.indexOf(targetLevel) >= levelOrder.indexOf(VerificationLevel.HIGH_VETTING)) {
            requirements.push({ type: 'INTERVIEW', isRequired: true, allowedTypes: ['NONE'], label: 'Interview' });
            requirements.push({ type: 'REFERENCES', isRequired: true, allowedTypes: ['NONE'], label: 'References' });
        }

        res.status(200).json({
            success: true,
            data: {
                currentLevel: provider.verificationLevel,
                targetLevel,
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
