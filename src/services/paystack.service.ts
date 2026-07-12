import axios from 'axios';
import PaymentProvider from '../models/PaymentProvider';
import crypto from 'crypto';
import { logger } from '../utils/logger';

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
  countryCode: string,
  config?: any // Optional pre-resolved configuration
): Promise<PaystackInitializeResponse> => {
  logger.debug(`PAYSTACK | INITIALIZE | Email: ${email} | Country: ${countryCode}`);

  // 1. Use provided config or resolve Paystack configuration for this specific country
  const provider = config || await PaymentProvider.findOne({
      code: { $regex: new RegExp(`^paystack$`, 'i') },
      countryCode: countryCode,
      isActive: true
  });

  if (!provider) {
    logger.error(`PAYSTACK | CONFIG_ERROR: No active Paystack configuration found for country ${countryCode}.`);
    throw new Error(`Paystack is not configured for country: ${countryCode}`);
  }

  if (!provider.secretKey) {
    logger.error(`PAYSTACK | CONFIG_ERROR: Paystack secret key missing for country ${countryCode} (Config ID: ${provider._id})`);
    throw new Error(`Paystack secret key is missing for country: ${countryCode}`);
  }

  // Paystack amount is in kobo (base unit * 100)
  const amountInBaseUnit = Math.round(amount * 100);

  try {
      const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email,
          amount: amountInBaseUnit,
          currency: provider.currency || currency,
          metadata,
          callback_url: provider.callbackUrl || process.env.PAYSTACK_CALLBACK_URL
        },
        {
          headers: {
            Authorization: `Bearer ${provider.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.payment('INITIALIZED', 'PENDING', response.data.data.reference, amount);
      return response.data;
  } catch (axiosError: any) {
      const errorData = axiosError.response?.data;
      logger.error(`PAYSTACK | INITIALIZE_FAILED | Status: ${axiosError.response?.status} | Msg: ${errorData?.message || axiosError.message}`);
      throw new Error(`Gateway Error: ${errorData?.message || axiosError.message}`);
  }
};

export const verifyTransaction = async (reference: string, countryCode: string): Promise<any> => {
  const provider = await PaymentProvider.findOne({
      code: { $regex: new RegExp(`^paystack$`, 'i') },
      countryCode: countryCode,
      isActive: true
  });

  if (!provider || !provider.secretKey) {
    console.error(`[PAYSTACK_VERIFY_ERROR] No active Paystack configuration for country ${countryCode}`);
    throw new Error(`Paystack secret key is not configured for country: ${countryCode}`);
  }

  const response = await axios.get(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${provider.secretKey}`
      }
    }
  );

  return response.data;
};

export const getProviderConfig = async (countryCode: string): Promise<any> => {
    return await PaymentProvider.findOne({
        code: { $regex: new RegExp(`^paystack$`, 'i') },
        countryCode: countryCode,
        isActive: true
    });
};

export const isValidSignature = (rawBody: Buffer, signature: string, secret: string): boolean => {
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    return hash === signature;
};
