import { Request, Response } from 'express';
import admin from 'firebase-admin';

export const testStorage = async (req: Request, res: Response) => {
    const results: any[] = [];
    const bucketsToTry = [
        'towmech-dc8c4.appspot.com',
        'towmech-dc8c4.firebasestorage.app',
        'towmech-dc8c4'
    ];

    const app = admin.app();

    for (const bName of bucketsToTry) {
        try {
            console.log(`TESTING BUCKET: ${bName}`);
            const bucket = admin.storage().bucket(bName);
            const filename = `piecejob/test/test_${bName.replace(/\./g, '_')}.txt`;
            const file = bucket.file(filename);
            await file.save(`Test at ${new Date().toISOString()}`, { public: false });
            results.push({ bucket: bName, success: true, path: filename });
        } catch (err: any) {
            console.error(`FAILED BUCKET: ${bName}`, err.message);
            results.push({ bucket: bName, success: false, error: err.message });
        }
    }

    res.status(200).json({
        success: results.some(r => r.success),
        projectId: app.options.projectId,
        storageConfig: app.options.storageBucket,
        results
    });
};
