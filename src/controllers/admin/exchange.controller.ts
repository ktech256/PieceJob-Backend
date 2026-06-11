import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import ExchangeRate from '../../models/ExchangeRate';

export const listRates = async (req: AuthRequest, res: Response) => {
  try {
    const rates = await ExchangeRate.find();
    res.status(200).json({ success: true, rates });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch rates', error });
  }
};

export const updateRate = async (req: AuthRequest, res: Response) => {
  try {
    const { fromCurrency, toCurrency, rate } = req.body;
    const exchangeRate = await ExchangeRate.findOneAndUpdate(
        { fromCurrency, toCurrency },
        { rate },
        { upsert: true, new: true }
    );
    res.status(200).json({ success: true, exchangeRate });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update rate', error });
  }
};
