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
    console.log(`[PAYMENT_ROUTING] Looking for active providers in country: ${countryCode}`);

    // 1. Resolve the highest priority active provider for the country
    const provider = await PaymentProvider.findOne({
        countryCode: countryCode.toUpperCase(),
        isActive: true
    }).sort({ priority: 1 });

    if (!provider) {
        console.error(`[PAYMENT_ROUTING_ERROR] No active payment provider found for country: ${countryCode}. Check DB for countryCode: ${countryCode.toUpperCase()}`);
        return {
            success: false,
            message: `No payment gateway configured for country: ${countryCode}`,
            gatewayCode: 'NONE'
        };
    }

    console.log(`[PAYMENT_ROUTING] Found Provider! ID: ${provider._id}, Code: '${provider.code}', Name: ${provider.name}, Priority: ${provider.priority}`);

    // 2. Route to the specific gateway service
    try {
        const normalizedCode = provider.code.trim().toLowerCase();
        console.log(`[PAYMENT_ROUTING] Normalized Code: '${normalizedCode}'`);

        switch (normalizedCode) {
            case 'paystack': {
                const res = await paystackService.initializeTransaction(
                    email,
                    amount,
                    currency,
                    metadata,
                    countryCode,
                    provider // Pass the pre-resolved provider config
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
                console.error(`[PAYMENT_ROUTING_ERROR] Implementation missing for: '${normalizedCode}'`);
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
