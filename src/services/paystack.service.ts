import axios from 'axios';
import * as settingsService from './settings.service';

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export const initializeTransaction = async (
  email: string,
  amount: number,
  currency: string,
  metadata: any,
  countryCode: string
): Promise<PaystackInitializeResponse> => {
  const settings = await settingsService.getSettings(countryCode);
  const secretKey = settings.integrations.paymentSecretKey;

  if (!secretKey) {
    throw new Error('Paystack secret key is not configured for this country.');
  }

  // Paystack amount is in kobo (base unit * 100)
  const amountInBaseUnit = Math.round(amount * 100);

  const response = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email,
      amount: amountInBaseUnit,
      currency,
      metadata,
      callback_url: 'piecejob://payment-callback' // Deep link for Android
    },
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
};

export const verifyTransaction = async (reference: string, countryCode: string): Promise<any> => {
  const settings = await settingsService.getSettings(countryCode);
  const secretKey = settings.integrations.paymentSecretKey;

  if (!secretKey) {
    throw new Error('Paystack secret key is not configured.');
  }

  const response = await axios.get(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    }
  );

  return response.data;
};
