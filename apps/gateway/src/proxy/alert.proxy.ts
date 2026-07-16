import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const alertProxy = createProxy(services.ALERT_SERVICE);
