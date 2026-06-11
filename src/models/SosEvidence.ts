import mongoose, { Schema, Document } from 'mongoose';

export interface IGpsPing {
  coordinates: number[];
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp: Date;
}

export interface IAudioSegment {
  url: string;
  duration: number;
  timestamp: Date;
}

export interface ISosEvidence extends Document {
  incidentId: mongoose.Types.ObjectId;
  gpsStream: IGpsPing[];
  audioStream: IAudioSegment[];
  chatHistorySnapshot: any[];
  photos: {
    url: string;
    gpsPosition?: number[];
    timestamp: Date;
  }[];
  notes: {
    adminId: mongoose.Types.ObjectId;
    text: string;
    timestamp: Date;
  }[];
}

const SosEvidenceSchema: Schema = new Schema({
  incidentId: { type: Schema.Types.ObjectId, ref: 'SosIncident', required: true, unique: true },
  gpsStream: [{
    coordinates: { type: [Number], required: true },
    speed: { type: Number },
    heading: { type: Number },
    accuracy: { type: Number },
    timestamp: { type: Date, default: Date.now }
  }],
  audioStream: [{
    url: { type: String, required: true },
    duration: { type: Number },
    timestamp: { type: Date, default: Date.now }
  }],
  chatHistorySnapshot: [{ type: Schema.Types.Mixed }],
  photos: [{
    url: { type: String, required: true },
    gpsPosition: { type: [Number] },
    timestamp: { type: Date, default: Date.now }
  }],
  notes: [{
    adminId: { type: Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

export default mongoose.model<ISosEvidence>('SosEvidence', SosEvidenceSchema);
