interface AlertServiceEnv {
  kafkaBrokers: string[];
  kafkaTrackTopic: string;
  kafkaAlertTopic: string;
  kafkaAdvisoryTopic: string;
  kafkaWeatherTopic: string;
  kafkaAerodromeTopic: string;
  kafkaConsumerGroup: string;
  advisoryServiceUrl: string;
  aerodromeServiceUrl: string;
  weatherServiceUrl: string;
}

export const alertServiceEnv: AlertServiceEnv = {
  kafkaBrokers: process.env.ALERT_KAFKA_BROKERS
    ? process.env.ALERT_KAFKA_BROKERS.split(",").map((b) => b.trim())
    : [],
  kafkaTrackTopic: process.env.ALERT_KAFKA_TRACK_TOPIC || "asmgcs.tracks",
  kafkaAlertTopic: process.env.ALERT_KAFKA_ALERT_TOPIC || "asmgcs.alerts",
  kafkaAdvisoryTopic:
    process.env.ALERT_KAFKA_ADVISORY_TOPIC || "asmgcs.advisory",
  kafkaWeatherTopic: process.env.ALERT_KAFKA_WEATHER_TOPIC || "asmgcs.weather",
  kafkaAerodromeTopic:
    process.env.ALERT_KAFKA_AERODROME_TOPIC || "asmgcs.aerodrome",
  kafkaConsumerGroup:
    process.env.ALERT_KAFKA_CONSUMER_GROUP || "asmgcs-alert-service",
  advisoryServiceUrl:
    process.env.ADVISORY_SERVICE_URL || "http://advisory-service:3007",
  aerodromeServiceUrl:
    process.env.AERODROME_SERVICE_URL || "http://aerodrome-service:3006",
  weatherServiceUrl:
    process.env.WEATHER_SERVICE_URL || "http://weather-service:3008",
};
