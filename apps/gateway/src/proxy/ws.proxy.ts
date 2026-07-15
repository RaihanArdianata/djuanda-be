import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const wsProxy = createProxy(services.WS_SERVICE);
