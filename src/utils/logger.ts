export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

class Logger {
    private level: LogLevel = LogLevel.INFO;

    constructor() {
        const envLevel = process.env.LOG_LEVEL?.toUpperCase();
        if (envLevel === 'DEBUG') this.level = LogLevel.DEBUG;
        else if (envLevel === 'INFO') this.level = LogLevel.INFO;
        else if (envLevel === 'WARN') this.level = LogLevel.WARN;
        else if (envLevel === 'ERROR') this.level = LogLevel.ERROR;
    }

    debug(message: string, ...args: any[]) {
        if (this.level <= LogLevel.DEBUG) {
            console.log(`[DEBUG] ${message}`, ...args);
        }
    }

    info(message: string, ...args: any[]) {
        if (this.level <= LogLevel.INFO) {
            console.log(`[INFO] ${message}`, ...args);
        }
    }

    warn(message: string, ...args: any[]) {
        if (this.level <= LogLevel.WARN) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    }

    error(message: string, ...args: any[]) {
        if (this.level <= LogLevel.ERROR) {
            console.error(`[ERROR] ${message}`, ...args);
        }
    }

    // Specialized loggers for structured output
    auth(action: string, success: boolean, identifier: string, error?: string) {
        this.info(`AUTH | ${action} | ${success ? 'SUCCESS' : 'FAILED'} | User: ${identifier} ${error ? '| Error: ' + error : ''}`);
    }

    payment(action: string, status: string, reference: string, amount?: number) {
        this.info(`PAYMENT | ${action} | ${status} | Ref: ${reference} ${amount ? '| R' + amount : ''}`);
    }

    matching(jobId: string, wave: number, summary: string) {
        this.info(`MATCHING | Job: ${jobId} | Wave: ${wave} | ${summary}`);
    }

    email(action: string, status: string, to: string, details?: string) {
        this.info(`EMAIL | ${action} | ${status} | To: ${to} ${details ? '| ' + details : ''}`);
    }

    fcm(action: string, status: string, userId: string, details?: string) {
        this.info(`FCM | ${action} | ${status} | User: ${userId} ${details ? '| ' + details : ''}`);
    }

    socket(event: string, socketId: string, details?: string) {
        this.debug(`SOCKET | ${event} | ID: ${socketId} ${details ? '| ' + details : ''}`);
    }

    heartbeat(userId: string, isOnline: boolean) {
        this.debug(`HEARTBEAT | User: ${userId} | Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
    }
}

export const logger = new Logger();
