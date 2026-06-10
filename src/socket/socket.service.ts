import { Server, Socket } from 'socket.io';
import Job, { JobStatus } from '../models/Job';

let io: Server;

function calculateDistance(c1: number[], c2: number[]) {
  const R = 6371e3; // meters
  const lat1 = c1[1] * Math.PI/180;
  const lat2 = c2[1] * Math.PI/180;
  const dLat = (c2[1]-c1[1]) * Math.PI/180;
  const dLon = (c2[0]-c1[0]) * Math.PI/180;

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1) * Math.cos(lat2) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // in meters
}

export const initSocket = (server: any) => {
  io = new Server(server, {
    cors: { origin: "*" }
  });

  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join_job', (jobId: string) => {
      socket.join(`job_${jobId}`);
      console.log(`Socket ${socket.id} joined room job_${jobId}`);
    });

    socket.on('update_location', async (data: { jobId: string, coordinates: number[] }) => {
      // 1. Emit to the job room so the customer can track
      io.to(`job_${data.jobId}`).emit('location_updated', {
        jobId: data.jobId,
        coordinates: data.coordinates,
        timestamp: new Date()
      });

      // 2. Check for ARRIVED auto-trigger (20m rule)
      const job = await Job.findById(data.jobId);
      if (job && job.status === JobStatus.ACCEPTED) {
        const distance = calculateDistance(data.coordinates, job.location.coordinates);
        if (distance <= 20) {
          job.status = JobStatus.ARRIVED;
          await job.save();
          io.to(`job_${data.jobId}`).emit('status_updated', { jobId: job.id, status: JobStatus.ARRIVED });
        }
      }
    });

    socket.on('update_location', (data: { jobId: string, coordinates: number[] }) => {
      // Emit to the job room so the customer can track
      io.to(`job_${data.jobId}`).emit('location_updated', {
        jobId: data.jobId,
        coordinates: data.coordinates,
        timestamp: new Date()
      });
    });

    socket.on('send_message', (data: { jobId: string, text: string, senderId: string, receiverId: string }) => {
      // Broadcast to the job room
      io.to(`job_${data.jobId}`).emit('new_message', {
        jobId: data.jobId,
        text: data.text,
        senderId: data.senderId,
        createdAt: new Date()
      });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
};

export const emitJobUpdate = (jobId: string, event: string, data: any) => {
  if (io) {
    io.to(`job_${jobId}`).emit(event, data);
  }
};

export const emitToUser = (userId: string, event: string, data: any) => {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
};
