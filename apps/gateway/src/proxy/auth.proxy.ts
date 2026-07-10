import { services } from "../config/services";
import { createProxy } from "../lib/proxy";

export const authProxy = createProxy(services.AUTH_SERVICE);
