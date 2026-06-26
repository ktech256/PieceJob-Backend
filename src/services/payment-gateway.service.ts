import PaymentProvider from '../models/PaymentProvider';
import * as paystackService from './paystack.service';

export interface PaymentInitializationResult {
    success: boolean;
    message?: string;
    paymentUrl?: string;
    reference?: string;
    gatewayCode: string;
}

/**
 * Payment Gateway Service
 * Resolves the appropriate payment gateway for a country and initializes the transaction.
 */
export const initializePayment = async (
    email: string,
    amount: number,
    currency: string,
    metadata: any,
    countryCode: string
): Promise<PaymentInitializationResult> => {
    // 1. Resolve the highest priority active provider for the country
    const provider = await PaymentProvider.findOne({
        countryCode,
        isActive: true
    }).sort({ priority: 1 });

    if (!provider) {
        console.error(`[PAYMENT_ROUTING_ERROR] No active payment provider found for country: ${countryCode}`);
        return {
            success: false,
            message: `No payment gateway configured for country: ${countryCode}`,
            gatewayCode: 'NONE'
        };
    }

    console.log(`[PAYMENT_ROUTING] Using gateway: ${provider.code} (${provider.name}) for ${countryCode}`);

    // 2. Route to the specific gateway service
    try {
        switch (provider.code.toLowerCase()) {
            case 'paystack': {
                const res = await paystackService.initializeTransaction(
                    email,
                    amount,
                    currency,
                    metadata,
                    countryCode
                );
                return {
                    success: res.status,
                    message: res.message,
                    paymentUrl: res.data.authorization_url,
                    reference: res.data.reference,
                    gatewayCode: 'paystack'
                };
            }
            // Add other gateways here (Stripe, Ozow, etc.)
            default:
                return {
                    success: false,
                    message: `Gateway ${provider.code} implementation missing`,
                    gatewayCode: provider.code
                };
        }
    } catch (error: any) {
        console.error(`[PAYMENT_GATEWAY_ERROR] ${provider.code} failed:`, error.message);
        return {
            success: false,
            message: error.message || 'Payment initialization failed',
            gatewayCode: provider.code
        };
    }
};
