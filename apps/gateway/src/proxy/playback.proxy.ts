import { services } from "@/config/services";
import { createProxy } from "@/lib/proxy";

export const playbackProxy = createProxy(services.PLAYBACK_SERVICE);
