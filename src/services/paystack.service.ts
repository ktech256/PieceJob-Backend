import axios from 'axios';
import PaymentProvider from '../models/PaymentProvider';

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
  console.log(`[PAYSTACK_TRACE] Step 1: Starting initialization for ${email} in country ${countryCode}`);

  // 1. Use provided config or resolve Paystack configuration for this specific country
  const provider = config || await PaymentProvider.findOne({
      code: { $regex: new RegExp(`^paystack$`, 'i') },
      countryCode: countryCode,
      isActive: true
  });

  if (!provider) {
    console.error(`[PAYSTACK_TRACE] ERROR: No active Paystack configuration found for country ${countryCode}. Query criteria: code=paystack, countryCode=${countryCode}, isActive=true`);
    throw new Error(`Paystack is not configured for country: ${countryCode}`);
  }

  if (!provider.secretKey) {
    console.error(`[PAYSTACK_TRACE] ERROR: Paystack secret key missing for country ${countryCode} (Config ID: ${provider._id})`);
    throw new Error(`Paystack secret key is missing for country: ${countryCode}`);
  }

  console.log(`[PAYSTACK_TRACE] Step 2: Config resolved. ID: ${provider._id}, Merchant: ${provider.merchantId || 'N/A'}, Env: ${provider.environment}`);

  // Paystack amount is in kobo (base unit * 100)
  const amountInBaseUnit = Math.round(amount * 100);

  console.log(`[PAYSTACK_TRACE] Step 3: Preparing payload. Amount: ${amountInBaseUnit} ${provider.currency || currency}`);

  try {
      const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email,
          amount: amountInBaseUnit,
          currency: provider.currency || currency,
          metadata,
          callback_url: provider.callbackUrl || 'piecejob://payment-callback'
        },
        {
          headers: {
            Authorization: `Bearer ${provider.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[PAYSTACK_TRACE] Step 4: Success. Reference: ${response.data.data.reference}`);
      return response.data;
  } catch (axiosError: any) {
      const errorData = axiosError.response?.data;
      console.error(`[PAYSTACK_TRACE] FATAL: Gateway Rejected Request. Status: ${axiosError.response?.status}. Message: ${errorData?.message || axiosError.message}`);
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
