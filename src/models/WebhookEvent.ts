import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhookEvent extends Document {
  gatewayEventId: string;
  gateway: string;
  eventHash: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  processedAt?: Date;
  payload: any;
}

const WebhookEventSchema: Schema = new Schema({
  gatewayEventId: { type: String, required: true },
  gateway: { type: String, required: true },
  eventHash: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'PROCESSED', 'FAILED'], default: 'PENDING' },
  processedAt: { type: Date },
  payload: { type: Schema.Types.Mixed }
}, { timestamps: true });

// Prevent duplicate processing at DB level
WebhookEventSchema.index({ gatewayEventId: 1, gateway: 1 }, { unique: true });

export default mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);
