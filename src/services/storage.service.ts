import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export const uploadBase64File = async (base64Data: string, folder: string, mimeType: string): Promise<string> => {
    try {
        const bucket = admin.storage().bucket();

        logger.debug(`STORAGE | UPLOAD_START | Bucket: ${bucket.name} | Folder: ${folder}`);

        let ext = 'bin';
        if (mimeType.includes('pdf')) ext = 'pdf';
        else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
        else if (mimeType.includes('png')) ext = 'png';

        // Prepend piecejob/ to isolate from TowMech files
        const filename = `piecejob/${folder}/${uuidv4()}_${Date.now()}.${ext}`;
        const file = bucket.file(filename);

        const buffer = Buffer.from(base64Data, 'base64');
        await file.save(buffer, {
            metadata: { contentType: mimeType },
            public: false
        });

        logger.debug(`STORAGE | UPLOAD_SUCCESS | Path: ${filename}`);
        // Return the permanent bucket path
        return filename;
    } catch (error: any) {
        logger.error(`STORAGE | UPLOAD_FAILED | Error: ${error.message}`);
        throw new Error(`Failed to upload file to storage: ${error.message}`);
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
    } catch (error: any) {
        logger.error(`STORAGE | SIGNED_URL_ERROR | Path: ${path} | Error: ${error.message}`);
        return '';
    }
};

export const deleteFile = async (path: string): Promise<void> => {
    try {
        if (!path || path.startsWith('http')) return;
        const bucket = admin.storage().bucket();
        await bucket.file(path).delete();
    } catch (error: any) {
        logger.error(`STORAGE | DELETE_ERROR | Path: ${path} | Error: ${error.message}`);
    }
};
