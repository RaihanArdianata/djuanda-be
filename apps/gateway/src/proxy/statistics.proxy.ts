import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const statisticsProxy = createProxy(services.STATISTICS_SERVICE);