import mongoose from 'mongoose';
import SosIncident, { SosStatus } from '../models/SosIncident';
import SosEvidence from '../models/SosEvidence';
import SosTimeline from '../models/SosTimeline';
import Counter from '../models/Counter';
import User from '../models/User';
import Provider from '../models/Provider';
import Chat from '../models/Chat';
import { emitToUser, emitAdminUpdate } from '../socket/socket.service';
import * as notificationQueue from './notification.queue';
import AuditLog from '../models/AuditLog';

const getNextIncidentSequence = async (countryCode: string) => {
    const counter = await Counter.findOneAndUpdate(
        { id: `sos_${countryCode}` },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
    );
    return counter.seq;
};

export const activateSos = async (
    userId: string,
    userType: 'CUSTOMER' | 'PROVIDER',
    coordinates: number[],
    countryCode: string,
    jobId?: string
) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const seq = await getNextIncidentSequence(countryCode);
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const incidentId = `INC-${dateStr}-${seq.toString().padStart(4, '0')}`;

        // 1. Create Incident
        const incident = new SosIncident({
            incidentId,
            userId,
            userType,
            jobId,
            countryCode,
            status: SosStatus.ACTIVE,
            location: { type: 'Point', coordinates },
            activatedAt: new Date()
        });
        await incident.save({ session });

        // 2. Create Evidence Record
        let chatSnapshot = [];
        if (jobId) {
            chatSnapshot = await Chat.find({ jobId }).session(session);
        }

        const evidence = new SosEvidence({
            incidentId: incident._id,
            gpsStream: [{ coordinates, timestamp: new Date() }],
            chatHistorySnapshot: chatSnapshot
        });
        await evidence.save({ session });

        incident.evidencePackageId = evidence._id as any;
        await incident.save({ session });

        // 3. Create Timeline
        const timeline = new SosTimeline({
            incidentId: incident._id,
            events: [{
                action: 'SOS_ACTIVATED',
                userId: userId as any,
                timestamp: new Date(),
                metadata: { source: userType, coordinates }
            }]
        });
        await timeline.save({ session });

        await session.commitTransaction();

        // 4. Notifications & Alerts
        broadcastSosAlert(incident);

        return incident;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

export const broadcastSosAlert = async (incident: any) => {
    // Notify 5 nearest providers
    const nearestProviders = await Provider.find({
        isOnline: true,
        verificationStatus: 'APPROVED',
        location: {
            $near: {
                $geometry: { type: 'Point', coordinates: incident.location.coordinates },
                $maxDistance: 5000 // 5km radius
            }
        }
    }).limit(5);

    const providerUserIds = nearestProviders.map(p => p.userId);
    const usersWithTokens = await User.find({
        _id: { $in: providerUserIds },
        fcmToken: { $exists: true, $ne: null }
    }).select('_id fcmToken');

    nearestProviders.forEach(p => {
        emitToUser(p.userId.toString(), 'SOS_NEARBY', {
            incidentId: incident.incidentId,
            coordinates: incident.location.coordinates
        });
    });

    // Notify Admins in workspace
    emitAdminUpdate('sos_siren_trigger', {
        incidentId: incident.incidentId,
        _id: incident._id,
        userId: incident.userId,
        userType: incident.userType,
        coordinates: incident.location.coordinates,
        countryCode: incident.countryCode
    });

    // Push Notifications with Deduplication (using incidentId + userId)
    for (const u of usersWithTokens) {
        await notificationQueue.addNotificationToQueue({
            type: 'PUSH',
            userId: u._id.toString(),
            fcmToken: u.fcmToken,
            templateCode: 'SOS_NEARBY',
            templateData: { incidentId: incident.incidentId },
            data: { incidentId: incident.incidentId, alertType: 'SOS' },
            countryCode: incident.countryCode
        }, `SOS_ALERT_${incident.incidentId}_${u._id}`);
    }
};

export const logGpsPing = async (incidentId: string, ping: any) => {
    await SosEvidence.findOneAndUpdate(
        { incidentId },
        { $push: { gpsStream: ping } }
    );
};

export const updateIncidentStatus = async (id: string, status: SosStatus, adminId: string, reason?: string) => {
    const incident = await SosIncident.findById(id);
    if (!incident) throw new Error('Incident not found');

    const oldStatus = incident.status;
    incident.status = status;
    if (status === SosStatus.RESOLVED) incident.resolvedAt = new Date();
    if (status === SosStatus.ACKNOWLEDGED && !incident.assignedAdminId) {
        incident.assignedAdminId = adminId as any;
    }
    await incident.save();

    await SosTimeline.findOneAndUpdate(
        { incidentId: id },
        { $push: { events: {
            action: `STATUS_CHANGED_${status}`,
            userId: adminId as any,
            timestamp: new Date(),
            metadata: { oldStatus, reason }
        }}}
    );

    // Audit Log
    await AuditLog.create({
        adminId: adminId as any,
        action: `SOS_STATUS_${status}`,
        targetId: id,
        targetCollection: 'SosIncidents',
        previousValue: { status: oldStatus },
        newValue: { status, reason },
        ipAddress: 'System'
    });

    if (status === SosStatus.RESOLVED) {
        emitAdminUpdate('sos_siren_stop', { _id: id });
    }

    return incident;
};

export const archiveIncident = async (id: string, adminId: string) => {
    const incident = await SosIncident.findById(id);
    if (!incident) throw new Error('Incident not found');
    if (incident.status !== SosStatus.RESOLVED) throw new Error('Must resolve incident before archiving');

    incident.status = SosStatus.ARCHIVED;
    await incident.save();

    await SosTimeline.findOneAndUpdate(
        { incidentId: id },
        { $push: { events: {
            action: 'INCIDENT_ARCHIVED',
            userId: adminId as any,
            timestamp: new Date()
        }}}
    );

    return incident;
};
