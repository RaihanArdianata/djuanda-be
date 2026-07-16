import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const usersProxy = createProxy(services.USER_SERVICE);
