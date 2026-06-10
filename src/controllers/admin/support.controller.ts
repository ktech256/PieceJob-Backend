import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import SupportTicket from '../../models/SupportTicket';

export const listTickets = async (req: AuthRequest, res: Response) => {
  try {
    const query: any = { countryCode: req.user?.countryCode };
    const tickets = await SupportTicket.find(query).populate('userId', 'firstName lastName phone');
    res.status(200).json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch tickets', error });
  }
};

export const updateTicket = async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const ticket = await SupportTicket.findByIdAndUpdate(ticketId, req.body, { new: true });
    res.status(200).json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed', error });
  }
};
