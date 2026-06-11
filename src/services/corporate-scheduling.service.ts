import mongoose from 'mongoose';
import CorporateSchedule, { ScheduleFrequency } from '../models/CorporateSchedule';
import Job, { JobStatus } from '../models/Job';
import * as jobService from './job.service';

export const processSchedules = async () => {
    const now = new Date();
    const schedules = await CorporateSchedule.find({
        isActive: true,
        nextRunDate: { $lte: now }
    });

    for (const schedule of schedules) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            // 1. Generate Job
            const job = new Job({
                customerId: schedule.creatorId,
                serviceCode: schedule.serviceCode,
                countryCode: schedule.countryCode,
                location: {
                    type: 'Point',
                    coordinates: schedule.jobData.coordinates,
                    address: schedule.jobData.address
                },
                bookingFee: schedule.jobData.bookingFee,
                status: JobStatus.DRAFT,
                metadata: {
                    corporateScheduleId: schedule._id,
                    companyId: schedule.companyId
                }
            });
            await job.save({ session });

            // 2. Update Schedule
            schedule.lastGeneratedDate = now;

            const nextRun = new Date(schedule.nextRunDate);
            if (schedule.frequency === ScheduleFrequency.DAILY) {
                nextRun.setDate(nextRun.getDate() + 1);
            } else if (schedule.frequency === ScheduleFrequency.WEEKLY) {
                nextRun.setDate(nextRun.getDate() + 7);
            } else if (schedule.frequency === ScheduleFrequency.MONTHLY) {
                nextRun.setMonth(nextRun.getMonth() + 1);
            }

            schedule.nextRunDate = nextRun;

            // Check if end date reached
            if (schedule.endDate && nextRun > schedule.endDate) {
                schedule.isActive = false;
            }

            await schedule.save({ session });

            await session.commitTransaction();
            console.log(`Generated corporate job for schedule ${schedule._id}`);
        } catch (error) {
            await session.abortTransaction();
            console.error(`Failed to process schedule ${schedule._id}:`, error);
        } finally {
            session.endSession();
        }
    }
};
