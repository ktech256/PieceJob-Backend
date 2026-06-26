import { Server, Socket } from 'socket.io';
import Job, { JobStatus } from '../models/Job';
import * as providerPresenceService from '../services/provider-presence.service';
import * as sosService from '../services/sos.service';
import * as fraudService from '../services/fraud.service';
import { calculateDistance } from '../utils/location';

let io: Server;

export const emitAdminUpdate = (event: string, data: any) => {
  if (io) {
    io.to('admin_monitoring').emit(event, data);
  }
};

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

    socket.on('join_user', (userId: string) => {
        socket.join(`user_${userId}`);
        console.log(`Socket ${socket.id} joined room user_${userId}`);
    });

    socket.on('join_admin', () => {
      socket.join('admin_monitoring');
      console.log(`Socket ${socket.id} joined admin_monitoring`);
    });

    socket.on('heartbeat', async (data: { userId: string, coordinates: number[], hardwareId?: string, isMockLocation?: boolean }) => {
        await providerPresenceService.handleHeartbeat(data.userId, data.coordinates, data.hardwareId, data.isMockLocation);
    });

    socket.on('sos_gps_ping', async (data: { incidentId: string, coordinates: number[], speed?: number, heading?: number }) => {
        const ping = { ...data, timestamp: new Date() };
        await sosService.logGpsPing(data.incidentId, ping);

        // Broadcast to admins watching the incident
        io.to(`sos_incident_${data.incidentId}`).emit('sos_live_gps', ping);
        io.to('admin_monitoring').emit('sos_live_gps_global', { ...ping, incidentId: data.incidentId });
    });

    socket.on('join_sos', (incidentId: string) => {
        socket.join(`sos_incident_${incidentId}`);
    });

    socket.on('update_location', async (data: { jobId: string, coordinates: number[], userId: string, role: string, heading?: number }) => {
      // 1. Emit to the job room so the customer can track
      io.to(`job_${data.jobId}`).emit('location_updated', {
        jobId: data.jobId,
        coordinates: data.coordinates,
        heading: data.heading || 0,
        timestamp: new Date()
      });

      // 2. Emit to admin monitoring room
      io.to('admin_monitoring').emit('live_gps_update', {
        userId: data.userId,
        role: data.role,
        coordinates: data.coordinates,
        jobId: data.jobId,
        timestamp: new Date()
      });

      // 3. Check for ARRIVED auto-trigger (20m rule)
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

    socket.on('send_message', async (data: { jobId: string, text: string, senderId: string, receiverId: string }) => {
      // PAGE 12: NLP Abuse Analysis
      await fraudService.analyzeTextForAbuse(data.senderId, data.text, data.jobId);

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

  // PAGE 7: GHOST OFFLINE DETECTION (Every 60s)
  setInterval(async () => {
      await providerPresenceService.checkGhostOffline();
  }, 60000);

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
