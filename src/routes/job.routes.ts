import { Router } from 'express';
import * as jobController from '../controllers/job.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '../models/User';

const router = Router({ mergeParams: true });

// PRIORITIZED: Job Cancellation & Status (Common fail points)
router.patch('/:jobId/cancel', authenticate, authorize([UserRole.CUSTOMER, UserRole.PROVIDER]), jobController.cancelJob);
router.post('/:jobId/cancel', authenticate, authorize([UserRole.CUSTOMER, UserRole.PROVIDER]), jobController.cancelJob);
router.patch('/:jobId/status', authenticate, jobController.updateJobStatus);

// Static Routes
router.post('/request', authenticate, authorize([UserRole.CUSTOMER]), jobController.requestJob);
router.get('/active', authenticate, jobController.getActiveJob);
router.get('/my-jobs', authenticate, jobController.getMyJobs);

// Param Routes
router.get('/:jobId', authenticate, jobController.getJobById);
router.post('/:jobId/pay-booking-fee', authenticate, authorize([UserRole.CUSTOMER]), jobController.payBookingFee);
router.put('/:jobId/accept', authenticate, authorize([UserRole.PROVIDER]), jobController.acceptJob);
router.post('/:jobId/rate', authenticate, authorize([UserRole.CUSTOMER, UserRole.PROVIDER]), jobController.rateJob);
router.post('/:jobId/dismiss-rating', authenticate, authorize([UserRole.CUSTOMER, UserRole.PROVIDER]), jobController.dismissRating);
router.post('/:jobId/request-photos', authenticate, authorize([UserRole.PROVIDER]), jobController.requestTaskPhotos);
router.post('/:jobId/mark-photos-seen', authenticate, authorize([UserRole.PROVIDER]), jobController.markTaskPhotosSeen);
router.post('/:jobId/upload-photos', authenticate, authorize([UserRole.CUSTOMER]), jobController.uploadTaskPhotos);
router.post('/:jobId/confirm-dispatch', authenticate, authorize([UserRole.PROVIDER]), jobController.confirmDispatch);
router.post('/:jobId/unable-to-locate', authenticate, authorize([UserRole.PROVIDER]), jobController.reportUnableToLocate);
router.get('/:jobId/receipt/download', authenticate, authorize([UserRole.CUSTOMER]), jobController.downloadReceipt);

export default router;
