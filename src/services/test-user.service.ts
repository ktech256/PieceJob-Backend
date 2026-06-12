import User from '../models/User';
import Wallet from '../models/Wallet';
import Job from '../models/Job';
import Message from '../models/Message';
import Invoice from '../models/Invoice';
import Notification from '../models/Notification';
import Ledger from '../models/Ledger';
import Provider from '../models/Provider';
import VerificationRequest from '../models/VerificationRequest';

const TEST_PHONE_START = 919999000;
const TEST_PHONE_END = 919999099;

/**
 * Checks if a phone number falls within the designated test account range.
 * Specification: 0919999000 to 0919999099
 * @param phoneNumber Phone number string with or without country code
 */
export const isTestNumber = (phoneNumber: string): boolean => {
    // Extract digits only
    const digits = phoneNumber.replace(/\D/g, '');

    // target the specific 10-digit sequence: 9199990XX at the end of string
    // This supports 0919999001 and +27919999001
    const regex = /9199990\d{2}$/;
    return regex.test(digits);
};

/**
 * Cleanup function to wipe all data related to test users.
 * This is a destructive operation and should only be called by Super Admins.
 */
export const deleteTestUsers = async () => {
    console.log('[CLEANUP] Starting test user data wipe...');

    // 1. Find all test user IDs
    const testUsers = await User.find({ isTestUser: true }).select('_id');
    const userIds = testUsers.map(u => u._id);

    if (userIds.length === 0) {
        console.log('[CLEANUP] No test users found.');
        return { success: true, count: 0 };
    }

    // 2. Sequential deletion from related collections
    const results = await Promise.all([
        User.deleteMany({ _id: { $in: userIds } }),
        Provider.deleteMany({ userId: { $in: userIds } }),
        Wallet.deleteMany({ userId: { $in: userIds } }),
        Job.deleteMany({ $or: [{ customerId: { $in: userIds } }, { providerId: { $in: userIds } }] }),
        Message.deleteMany({ $or: [{ senderId: { $in: userIds } }, { receiverId: { $in: userIds } }] }),
        Invoice.deleteMany({ userId: { $in: userIds } }),
        Notification.deleteMany({ userId: { $in: userIds } }),
        VerificationRequest.deleteMany({ userId: { $in: userIds } }),
        Ledger.deleteMany({ $or: [{ fromUserId: { $in: userIds } }, { toUserId: { $in: userIds } }] })
    ]);

    console.log(`[CLEANUP] Wipe complete. Removed ${userIds.length} test accounts and related records.`);
    return {
        success: true,
        usersRemoved: userIds.length,
        totalRecordsRemoved: results.reduce((acc, curr) => acc + (curr.deletedCount || 0), 0)
    };
};

/**
 * Checks if a user ID belongs to a flagged test account.
 */
export const isTestUser = async (userId: string | any): Promise<boolean> => {
    const user = await User.findById(userId).select('isTestUser');
    return user?.isTestUser || false;
};
