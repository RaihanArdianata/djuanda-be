import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const aerodromeProxy = createProxy(services.AERODROME_SERVICE);
