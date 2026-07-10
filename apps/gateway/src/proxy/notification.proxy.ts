import { services } from "../config/services";
import { createProxy } from "../lib/proxy";

export const notificationProxy = createProxy(services.NOTIFICATION_SERVICE);
