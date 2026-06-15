import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import SupportTicket, { TicketStatus, TicketType } from '../models/SupportTicket';

export const submitTicket = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId, type, subject, description, priority } = req.body;
        const userId = req.user?.userId;
        const role = req.user?.role as 'CUSTOMER' | 'PROVIDER';
        const countryCode = req.user?.countryCode as string;

        const ticket = new SupportTicket({
            userId,
            role,
            jobId,
            type,
            subject,
            description,
            priority: priority || 'MEDIUM',
            countryCode,
            status: TicketStatus.OPEN,
            timeline: [{
                status: TicketStatus.OPEN,
                action: 'TICKET_CREATED',
                reason: 'Ticket submitted via app',
                timestamp: new Date()
            }]
        });

        await ticket.save();
        res.status(201).json({ success: true, ticketId: ticket._id });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Submission failed', error });
    }
};

export const getMyTickets = async (req: AuthRequest, res: Response) => {
    try {
        const tickets = await SupportTicket.find({ userId: req.user?.userId })
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, tickets });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fetch failed', error });
    }
};

export const getTicketDetails = async (req: AuthRequest, res: Response) => {
    try {
        const { ticketId } = req.params;
        const ticket = await SupportTicket.findOne({ _id: ticketId, userId: req.user?.userId });
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
        res.status(200).json({ success: true, ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fetch failed', error });
    }
};

export const addTicketMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { ticketId } = req.params;
        const { text, attachments } = req.body;

        const ticket = await SupportTicket.findOne({ _id: ticketId, userId: req.user?.userId });
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

        ticket.messages.push({
            senderId: req.user?.userId as any,
            senderRole: 'USER',
            text,
            attachments: attachments || [],
            timestamp: new Date()
        });

        await ticket.save();
        res.status(200).json({ success: true, message: 'Message added', ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add message', error });
    }
};
