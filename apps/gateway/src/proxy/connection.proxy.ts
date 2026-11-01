import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const connectionProxy = createProxy(services.CONNECTION_SERVICE);
