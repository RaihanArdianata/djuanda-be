import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const advisoryProxy = createProxy(services.ADVISORY__SERVICE);
