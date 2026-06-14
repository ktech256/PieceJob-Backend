import { Request, Response } from 'express';
import admin from 'firebase-admin';

export const testStorage = async (req: Request, res: Response) => {
    try {
        const app = admin.app();
        const bucket = admin.storage().bucket();

        const audit = {
            activeBucket: bucket.name,
            projectId: app.options.projectId,
            storageConfig: app.options.storageBucket,
            timestamp: new Date().toISOString()
        };

        console.log("STORAGE TEST INITIATED", audit);

        const filename = 'piecejob/test/test.txt';
        const file = bucket.file(filename);
        const content = `Storage Test at ${audit.timestamp}`;

        await file.save(content, {
            metadata: { contentType: 'text/plain' },
            public: false
        });

        res.status(200).json({
            success: true,
            message: "SUCCESS: File physically written to bucket",
            path: filename,
            audit
        });
    } catch (error: any) {
        console.error("STORAGE TEST FAILED", error);
        res.status(500).json({
            success: false,
            message: "FAIL: Storage test encountered an error",
            error: error.message,
            stack: error.stack,
            code: error.code
        });
    }
};
