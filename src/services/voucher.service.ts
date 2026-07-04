import { logger } from '../utils/logger';

export enum VoucherVendor {
    OTT = 'OTT',
    BLUE = 'BLUE',
    ONE_VOUCHER = '1VOUCHER'
}

export const validateVoucher = async (vendor: string, voucherNumber: string, countryCode: string): Promise<{ isValid: boolean, amount: number }> => {
    // FORENSIC: Real implementation would hit vendor API.
    // For this module, we implement a robust verification simulator.

    logger.info(`VOUCHER_VERIFY | Vendor: ${vendor} | Code: ${voucherNumber} | Workspace: ${countryCode}`);

    // Simulation logic:
    // Any voucher starting with "TEST" is valid with value 100.
    // Any voucher starting with "PRE" followed by digits uses those digits as amount.
    if (voucherNumber.startsWith('TEST')) {
        return { isValid: true, amount: 100 };
    }

    if (voucherNumber.startsWith('PRE')) {
        const amountStr = voucherNumber.substring(3);
        const amount = parseFloat(amountStr);
        if (!isNaN(amount)) return { isValid: true, amount };
    }

    // Default: invalid
    return { isValid: false, amount: 0 };
};
