import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const notamProxy = createProxy(services.NOTAM_SERVICE);
