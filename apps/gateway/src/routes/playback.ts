import { Hono } from "hono";
import { playbackProxy } from "../proxy/playback.proxy";

const app = new Hono().all("/*", playbackProxy);

export default app;
