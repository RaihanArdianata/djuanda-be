import { connectionServiceToken } from "@/config/connection-token";
import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

// The caller proved who they are with their login JWT (see routes/connection.ts); what connection-service
// gets is the service token, so that token never has to be in the browser.
export const connectionProxy = createProxy(services.CONNECTION_SERVICE, {
  setHeaders: (): Record<string, string> => {
    const token = connectionServiceToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  },
});
