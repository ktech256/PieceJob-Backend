import mongoose from 'mongoose';
import FraudAlert, { FraudRiskType, FraudStatus } from '../models/FraudAlert';
import Job, { JobStatus } from '../models/Job';
import Provider from '../models/Provider';
import User from '../models/User';
import ServiceExpectedDuration from '../models/ServiceExpectedDuration';
import { v4 as uuidv4 } from 'uuid';
import { emitAdminUpdate } from '../socket/socket.service';
import * as auditService from './audit.service';

export const analyzeJobCompletion = async (jobId: string) => {
    const job = await Job.findById(jobId);
    if (!job || job.status !== JobStatus.COMPLETED) return;

    // 1. Calculate Actual Duration
    const startTime = job.startedAt || job.acceptedAt;
    if (!startTime) return;
    const actualDurationMin = (job.completedAt!.getTime() - startTime.getTime()) / (1000 * 60);

    // 2. Get Expected Duration
    const expected = await ServiceExpectedDuration.findOne({
        serviceCode: job.serviceCode,
        countryCode: job.countryCode
    });

    const expectedDurationMin = expected?.expectedDurationMinutes || 60; // Default to 60 if not found

    // 3. Check if actual < 50% of expected
    if (actualDurationMin < 0.5 * expectedDurationMin) {
        // Flag for FAKE_COMPLETION
        const fraudEventId = `FRAUD-${uuidv4().slice(0, 8).toUpperCase()}`;

        const alert = new FraudAlert({
            fraudEventId,
            countryCode: job.countryCode,
            userId: job.customerId,
            providerId: job.providerId,
            jobId: job._id,
            riskType: FraudRiskType.FAKE_COMPLETION,
            riskScore: 80,
            severity: 'HIGH',
            evidence: {
                actualDurationMin,
                expectedDurationMin,
                startTime: job.startedAt,
                endTime: job.completedAt
            }
        });
        await alert.save();

        // Put escrow on hold (Atomic update, only if not already set and not part of consolidated write)
        if (job.escrowStatus !== 'ESCROW_HOLD_REVIEW' && job.fraudFlag !== 'FAKE_COMPLETION') {
            await Job.updateOne(
                { _id: jobId, escrowStatus: { $ne: 'ESCROW_HOLD_REVIEW' } },
                {
                    $set: {
                        escrowStatus: 'ESCROW_HOLD_REVIEW',
                        fraudFlag: 'FAKE_COMPLETION'
                    }
                }
            );
        }

        emitAdminUpdate('fraud_alert', {
            alertId: alert.id,
            type: 'FAKE_COMPLETION',
            jobId: job.id,
            countryCode: job.countryCode
        });
    }

    // Update historical averages (simplified running average)
    if (expected) {
        const totalDuration = (expected.expectedDurationMinutes * expected.sampleSize) + actualDurationMin;
        expected.sampleSize += 1;
        expected.expectedDurationMinutes = totalDuration / expected.sampleSize;
        await expected.save();
    } else {
        await ServiceExpectedDuration.create({
            serviceCode: job.serviceCode,
            countryCode: job.countryCode,
            expectedDurationMinutes: actualDurationMin,
            sampleSize: 1
        });
    }
};

export const checkReferralAbuse = async (referrerId: string, referredId: string) => {
    // 1. Check if on same device/hardware
    const referrer = await Provider.findOne({ userId: referrerId });
    const referred = await User.findById(referredId);

    if (referrer?.hardwareId && referred?.hardwareId && referrer.hardwareId === referred.hardwareId) {
        const alert = new FraudAlert({
            fraudEventId: `REF-${uuidv4().slice(0, 8).toUpperCase()}`,
            countryCode: referred.countryCode || 'ZA',
            userId: referredId as any,
            riskType: FraudRiskType.REFERRAL_ABUSE,
            riskScore: 100,
            severity: 'CRITICAL',
            evidence: { referrerId, referredId, type: 'SAME_DEVICE', hardwareId: referrer.hardwareId }
        });
        await alert.save();
        return;
    }

    // 2. Circular Referral Check (A invites B, B invites A)
    const circular = await User.findOne({ _id: referrerId, referredBy: referredId });
    if (circular) {
         const alert = new FraudAlert({
            fraudEventId: `REF-${uuidv4().slice(0, 8).toUpperCase()}`,
            countryCode: circular.countryCode || 'ZA',
            userId: referredId as any,
            riskType: FraudRiskType.REFERRAL_ABUSE,
            riskScore: 100,
            severity: 'CRITICAL',
            evidence: { referrerId, referredId, type: 'CIRCULAR' }
        });
        await alert.save();
    }
};

export const logDeviceAccess = async (userId: string, hardwareId: string, ipAddress: string) => {
    // 1. Multi-account detection for any user type
    const overlaps = await User.find({
        hardwareId,
        _id: { $ne: new mongoose.Types.ObjectId(userId) }
    });

    if (overlaps.length > 0) {
        const alert = new FraudAlert({
            fraudEventId: `ACC-${uuidv4().slice(0, 8).toUpperCase()}`,
            countryCode: 'ZA',
            userId: userId as any,
            riskType: FraudRiskType.MULTI_ACCOUNT,
            riskScore: 60,
            severity: 'MEDIUM',
            evidence: { hardwareId, ipAddress, overlappedUsers: overlaps.map(u => u._id) }
        });
        await alert.save();
    }
};

export const checkMultiAccountDevice = async (providerId: string, hardwareId: string) => {
    if (!hardwareId) return;

    const duplicates = await Provider.find({
        hardwareId,
        _id: { $ne: new mongoose.Types.ObjectId(providerId) }
    });

    if (duplicates.length > 0) {
        const fraudEventId = `DEV-${uuidv4().slice(0, 8).toUpperCase()}`;
        const provider = await Provider.findById(providerId);
        const alert = new FraudAlert({
            fraudEventId,
            countryCode: provider?.countryCode || 'ZA',
            providerId: providerId as any,
            riskType: FraudRiskType.MULTI_ACCOUNT,
            riskScore: 75,
            severity: 'HIGH',
            evidence: { hardwareId, linkedProviders: duplicates.map(d => d._id) }
        });
        await alert.save();

        emitAdminUpdate('fraud_alert', {
            alertId: alert.id,
            type: 'MULTI_ACCOUNT',
            providerId,
            countryCode: provider?.countryCode || 'ZA'
        });
    }
};

export const checkGpsIntegrity = async (providerId: string, currentCoords: number[], previousCoords?: number[], timeDiffSec?: number) => {
    if (!previousCoords || !timeDiffSec || timeDiffSec <= 0) return;

    // Calculate Distance (Haversine simplified for small dist)
    const R = 6371; // km
    const dLat = (currentCoords[1] - previousCoords[1]) * Math.PI / 180;
    const dLon = (currentCoords[0] - previousCoords[0]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(previousCoords[1] * Math.PI / 180) * Math.cos(currentCoords[1] * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;

    // If movement > 2km in 1s (unrealistic speed)
    if (distanceKm > 2 && timeDiffSec <= 1) {
        await applyShadowBan(providerId, 'Impossible movement detected (GPS integrity violation)');
    }
};

export const applyShadowBan = async (providerId: string, reason: string) => {
    const provider = await Provider.findById(providerId);
    if (!provider) return;

    provider.isShadowBanned = true;
    provider.shadowBannedUntil = new Date(Date.now() + 3600 * 1000); // 1 hour shadow ban
    await provider.save();

    await auditService.logAdminAction({
        countryCode: provider.countryCode,
        adminId: 'SYSTEM',
        adminRole: 'SYSTEM',
        action: 'PROVIDER_SHADOW_BAN',
        entityType: 'Providers',
        entityId: providerId,
        afterState: { isShadowBanned: true, reason },
        ipAddress: 'System',
        systemSource: 'API'
    });

    const alert = new FraudAlert({
        fraudEventId: `GPS-${uuidv4().slice(0, 8).toUpperCase()}`,
        countryCode: provider.countryCode,
        providerId: provider._id,
        riskType: FraudRiskType.IMPOSSIBLE_MOVEMENT,
        riskScore: 90,
        severity: 'HIGH',
        evidence: { reason, timestamp: new Date() }
    });
    await alert.save();

    emitAdminUpdate('fraud_alert', {
        alertId: alert.id,
        type: 'SHADOW_BAN',
        providerId: provider.id,
        countryCode: provider.countryCode
    });
};

export const analyzeTextForAbuse = async (userId: string, text: string, jobId?: string) => {
    const hostileKeywords = ['insult', 'kill', 'scam', 'hack', 'bitch', 'idiot']; // Very simplified
    const found = hostileKeywords.filter(k => text.toLowerCase().includes(k));

    if (found.length > 0) {
        const user = await User.findById(userId);
        const alert = new FraudAlert({
            fraudEventId: `QC-${uuidv4().slice(0, 8).toUpperCase()}`,
            countryCode: user?.countryCode || 'ZA',
            userId: userId as any,
            jobId: jobId as any,
            riskType: FraudRiskType.QUALICHECK_ABUSE,
            riskScore: 50,
            severity: 'MEDIUM',
            evidence: { text, keywords: found }
        });
        await alert.save();

        emitAdminUpdate('fraud_alert', {
            alertId: alert.id,
            type: 'QUALICHECK',
            userId,
            countryCode: user?.countryCode || 'ZA'
        });
    }
};
