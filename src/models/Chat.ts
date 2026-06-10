import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  jobId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  text?: string;
  mediaUrl?: string;
  mediaType?: 'IMAGE' | 'VOICE';
  isRead: boolean;
  createdAt: Date;
}

const MessageSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String },
  mediaUrl: { type: String },
  mediaType: { type: String, enum: ['IMAGE', 'VOICE'] },
  isRead: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false }
}, { timestamps: true });

MessageSchema.index({ jobId: 1 });
MessageSchema.index({ senderId: 1, receiverId: 1 });

export default mongoose.model<IMessage>('Message', MessageSchema);
