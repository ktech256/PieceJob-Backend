import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

export const uploadBase64File = async (base64Data: string, folder: string, mimeType: string): Promise<string> => {
    try {
        const bucket = admin.storage().bucket();
        const filename = `${folder}/${uuidv4()}_${Date.now()}.${mimeType.split('/')[1]}`;
        const file = bucket.file(filename);

        const buffer = Buffer.from(base64Data, 'base64');
        await file.save(buffer, {
            metadata: { contentType: mimeType },
            public: false
        });

        // Return the permanent bucket path
        return filename;
    } catch (error) {
        console.error('Upload Error:', error);
        throw new Error('Failed to upload file to storage');
    }
};

export const getSignedUrl = async (path: string): Promise<string> => {
    try {
        if (!path || path.startsWith('http')) return path;

        const bucket = admin.storage().bucket();
        const file = bucket.file(path);

        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000 // 1 hour
        });

        return url;
    } catch (error) {
        console.error('Signed URL Error:', error);
        return '';
    }
};

export const deleteFile = async (path: string): Promise<void> => {
    try {
        if (!path || path.startsWith('http')) return;
        const bucket = admin.storage().bucket();
        await bucket.file(path).delete();
    } catch (error) {
        console.error('Delete Error:', error);
    }
};
