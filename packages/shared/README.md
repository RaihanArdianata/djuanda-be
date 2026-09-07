# @repo/shared

Cross-cutting primitives used by every service in the monorepo.

> **Important:** this package is intentionally **not** a catch-all barrel. Import the exact subpath you need so that module load side effects (e.g. ioredis, bcrypt, etc.) are only pulled in when required.

## Available subpaths

| Subpath | What it exports | Typical use |
|---|---|---|
| `@repo/shared/api-error` | `ApiError` (default) | Throw/catch domain errors with `code`, `statusCode`, and `message`. |
| `@repo/shared/api-response` | `success`, `failure`, `failureFromCode`, `errorResponse` | Build consistent `ApiEnvelope` responses. |
| `@repo/shared/catch-async` | `catchAsync` | Hono middleware wrapper that forwards errors to the global handler. |
| `@repo/shared/constants/errors` | `ErrorCode`, `resolveError`, `errorCodes` | Error codes and their metadata. |
| `@repo/shared/cors` | `createCorsMiddleware` | Generic CORS factory. |
| `@repo/shared/error-handler` | `errorHandler` | Global Hono error-to-response mapper. |
| `@repo/shared/metrics` | `metricsMiddleware`, `metricsHandler`, `getMetrics` | Prometheus metrics middleware and endpoint. |
| `@repo/shared/rate-limiter` | `rateLimiter`, `checkRateLimit`, `resetRateLimit` | Token-bucket rate limiting helpers. |
| `@repo/shared/sse/publisher` | `publishToTopic`, `getPublisher`, `createSubscriber`, `subscribeToTopic` | Redis-backed pub/sub for SSE. |
| `@repo/shared/testing/fakeRedis` | `FakeRedis` (class), `fakeRedis` (control) | In-memory ioredis fake for unit tests. |
| `@repo/shared/types/api-response` | `ApiResponse`, `ApiEnvelope`, `ApiPagination`, etc. | Shared response type contracts. |
| `@repo/shared/utils` | Re-export of all utilities below. | Only use when you really need everything. |
| `@repo/shared/utils/fileUtils` | File helpers. | File parsing/generation. |
| `@repo/shared/utils/formatter` | `passwordSchema`, `transformPhoneNumber` | Formatting and validation helpers. |
| `@repo/shared/utils/hashing` | `bcryptHash`, `bcryptVerify`, `sha256Hash` | Password and token hashing. |

## Usage examples

### ApiError

```ts
import ApiError from "@repo/shared/api-error";

throw new ApiError("NOT_FOUND", { message: "User not found" });
```

### ApiResponse helpers

```ts
import { success } from "@repo/shared/api-response";

return c.json(success({ user: { id: "u1" } }));
```

### catchAsync

```ts
import { catchAsync } from "@repo/shared/catch-async";

export const getUser = catchAsync(async (c) => {
  const user = await findUser();
  return c.json(success(user));
});
```

### CORS

```ts
import { createCorsMiddleware } from "@repo/shared/cors";

const app = new Hono().use(createCorsMiddleware({ origin: "*" }));
```

### Rate limiting

```ts
import { checkRateLimit, resetRateLimit } from "@repo/shared/rate-limiter";

const { allowed } = await checkRateLimit(key);
```

### SSE publisher

```ts
import { publishToTopic } from "@repo/shared/sse/publisher";

await publishToTopic("weather.updated", { station: "WARR", kind: "METAR" });
```

### Hashing

```ts
import { bcryptHash, bcryptVerify, sha256Hash } from "@repo/shared/utils/hashing";

const hash = await bcryptHash(password);
const ok = await bcryptVerify(password, hash);
```

## Test helpers

Use `FakeRedis` in unit tests to avoid real Redis connections.

```ts
import { FakeRedis } from "@repo/shared/testing/fakeRedis";

mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));
```

## Why subpaths?

Importing from `@repo/shared` (the root barrel) used to pull in `rateLimiter.ts` and `sse/publisher.ts`, both of which spin up an ioredis client at module load. By importing only the subpath your feature needs, tests start faster and side effects stay local.
