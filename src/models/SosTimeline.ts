import mongoose, { Schema, Document } from 'mongoose';

export interface ISosTimeline extends Document {
  incidentId: mongoose.Types.ObjectId;
  events: {
    action: string;
    userId?: mongoose.Types.ObjectId; // User, Admin, or System (null)
    userName?: string;
    metadata?: any;
    timestamp: Date;
  }[];
}

const SosTimelineSchema: Schema = new Schema({
  incidentId: { type: Schema.Types.ObjectId, ref: 'SosIncident', required: true, unique: true },
  events: [{
    action: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

export default mongoose.model<ISosTimeline>('SosTimeline', SosTimelineSchema);
