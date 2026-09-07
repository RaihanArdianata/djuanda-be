interface NotificationServiceEnv {
  kafkaBrokers: string[];
  kafkaAlertTopic: string;
  kafkaConsumerGroup: string;
}

export const notificationServiceEnv: NotificationServiceEnv = {
  kafkaBrokers: process.env.NOTIFICATION_KAFKA_BROKERS
    ? process.env.NOTIFICATION_KAFKA_BROKERS.split(",").map((b) => b.trim())
    : [],
  kafkaAlertTopic:
    process.env.NOTIFICATION_KAFKA_ALERT_TOPIC || "asmgcs.alerts",
  kafkaConsumerGroup:
    process.env.NOTIFICATION_KAFKA_CONSUMER_GROUP ||
    "asmgcs-notification-service",
};
