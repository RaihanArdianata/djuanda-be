import { Hono } from 'hono';
import { wsProxy } from '@/proxy/ws.proxy';

const app = new Hono().all('/*', wsProxy);

export default app;
