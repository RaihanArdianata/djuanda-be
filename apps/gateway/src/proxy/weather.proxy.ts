import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const weatherProxy = createProxy(services.WEATHER_SERVICE);
