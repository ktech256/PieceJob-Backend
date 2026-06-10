import Message from '../models/Chat';
import Job, { JobStatus } from '../models/Job';
import mongoose from 'mongoose';

export const archiveOldChats = async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // SECTION 11: 7-day retention rule
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Find jobs closed more than 7 days ago
        const closedJobs = await Job.find({
            status: JobStatus.CLOSED,
            updatedAt: { $lt: sevenDaysAgo }
        }).select('_id');

        const jobIds = closedJobs.map(j => j._id);

        if (jobIds.length > 0) {
            console.log(`Archiving chats for ${jobIds.length} jobs...`);

            // In a real production scenario, we would move these to a separate 'ArchivedMessages' collection
            // or an external cold storage like AWS Glacier.
            // For Phase 1, we simulate this by marking them as archived.

            await Message.updateMany(
                { jobId: { $in: jobIds } },
                { $set: { isArchived: true } }
            );
        }

        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        console.error('Chat archival failed:', error);
    } finally {
        session.endSession();
    }
};

export const deleteOldVoiceNotes = async () => {
    // SECTION 11: 14-day voice note cleanup
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const result = await Message.deleteMany({
        mediaType: 'VOICE',
        createdAt: { $lt: fourteenDaysAgo }
    });

    console.log(`Deleted ${result.deletedCount} old voice notes.`);
};
