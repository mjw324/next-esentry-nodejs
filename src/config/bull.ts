export const bullConfig = {
    monitor: {
        queueName: 'monitor-queue',
        defaultJobOptions: {
            removeOnComplete: true,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        },
    },
    notification: {
        queueName: 'notification-queue',
        defaultJobOptions: {
            removeOnComplete: true,
            attempts: 5,
        },
    },
    rateLimit: {
        queueName: 'rate-limit-queue',
    },
};