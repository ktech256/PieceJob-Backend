import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import SupportTicket, { TicketStatus, TicketType } from '../../models/SupportTicket';
import Job from '../../models/Job';
import Chat from '../../models/Chat';
import * as settlementService from '../../services/dispute-settlement.service';
import * as auditService from '../../services/audit.service';

export const listTickets = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode, status, type, priority } = req.query;
        const query: any = {};

        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (status) query.status = status;
        if (type) query.type = type;
        if (priority) query.priority = priority;

        const tickets = await SupportTicket.find(query)
            .populate('userId', 'firstName lastName email phoneNumber')
            .populate('assignedTo', 'firstName lastName')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, tickets });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list tickets', error });
    }
};

export const getTicketDetail = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const ticket = await SupportTicket.findById(id)
            .populate('userId', 'firstName lastName email phoneNumber')
            .populate('assignedTo', 'firstName lastName')
            .populate({
                path: 'jobId',
                populate: [
                    { path: 'customerId', select: 'firstName lastName phoneNumber' },
                    { path: 'providerId', select: 'firstName lastName phoneNumber' }
                ]
            });

        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

        res.status(200).json({ success: true, ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch ticket detail', error });
    }
};

export const assignTicket = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { adminId } = req.body;

        const ticket = await SupportTicket.findById(id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

        ticket.assignedTo = adminId;
        ticket.assignedAt = new Date();
        ticket.status = TicketStatus.INVESTIGATING;
        ticket.timeline.push({
            status: TicketStatus.INVESTIGATING,
            adminId: req.user?.userId as any,
            action: 'TICKET_ASSIGNED',
            reason: `Assigned to ${adminId}`,
            timestamp: new Date()
        });

        await ticket.save();

        await auditService.logAdminAction({
            countryCode: ticket.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'TICKET_ASSIGNMENT',
            entityType: 'SupportTicket',
            entityId: id,
            afterState: { assignedTo: adminId },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Assignment failed', error });
    }
};

export const getChatVault = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const ticket = await SupportTicket.findById(id);
        if (!ticket || !ticket.jobId) return res.status(404).json({ success: false, message: 'Job history not found' });

        const messages = await Chat.find({ jobId: ticket.jobId }).sort({ createdAt: 1 });

        // Audit Logging (Chat Access)
        await auditService.logChatAccess({
            countryCode: ticket.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            chatInfo: {
                jobId: ticket.jobId.toString(),
                accessReason: `Ticket Investigation: ${ticket.subject}`,
                userViewed: 'Both'
            },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Vault access failed', error });
    }
};

export const processEscrowSettlement = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { decision, customerAmount, providerAmount, reason } = req.body;

        const result = await settlementService.settleEscrow(
            id,
            decision,
            customerAmount,
            providerAmount,
            reason,
            req.user?.userId as string
        );

        res.status(200).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const resolveTicket = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status, internalNotes, isComplaintVerified } = req.body;

        const ticket = await SupportTicket.findById(id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

        ticket.status = status;
        if (internalNotes) ticket.internalNotes.push(internalNotes);

        ticket.timeline.push({
            status: status,
            adminId: req.user?.userId as any,
            action: 'TICKET_RESOLVED',
            reason: `Resolution: ${status}`,
            timestamp: new Date()
        });

        await ticket.save();

        // RC-2: Criminal Check Escalation Logic
        if (isComplaintVerified && ticket.role === 'PROVIDER') {
            await Provider.findOneAndUpdate(
                { userId: ticket.userId },
                { criminalCheckRequired: true }
            );
            console.log(`[COMPLIANCE] Criminal check mandated for provider ${ticket.userId} due to verified complaint.`);
        }

        res.status(200).json({ success: true, ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Resolution failed', error });
    }
};
