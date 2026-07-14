import { services } from '@/config/services';
import { createProxy } from '@/lib/proxy';

export const sseProxy = createProxy(services.SSE_SERVICE);
