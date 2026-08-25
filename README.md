# @screeny05/unstorage-driver-redis

Provides an [unstorage](https://unstorage.unjs.io/) driver which uses [ioredis](https://github.com/redis/ioredis) to store data.

This code is extracted from the [official unstorage driver](https://github.com/unjs/unstorage/blob/v1.17.2/src/drivers/redis.ts) for Redis with some slight modifications added:

- Support for `setItems` natively — a single `MSET` when no TTL applies, and a pipeline of
  `SET ... EX` when one does

  The official driver has no `setItems` in any 1.x release, so unstorage falls back to calling
  `setItem` once per item.

  `MSET` cannot carry a per-key TTL, which is why the expiry path writes each item individually.
  Carrying the expiry on the write means a key never exists untimed — writing with `MSET` and
  applying `EXPIRE` afterwards leaves a window in between, and a process that dies there, or a
  serverless isolate that freezes after responding, leaves those keys immortal.

  In cluster mode both `MSET` and pipelines require every key to hash to the same slot, so
  individual `SET` commands are sent instead.

## Installation

```bash
# Using pnpm
pnpm add @screeny05/unstorage-driver-redis

# Using yarn
yarn add @screeny05/unstorage-driver-redis

# Using npm
npm install @screeny05/unstorage-driver-redis
```

## Usage

```ts
import { createStorage } from 'unstorage';
import redisStorage from '@screeny05/unstorage-driver-redis';

const storage = createStorage({
  driver: redisStorage(),
});
```

Nitro configuration:

```ts
export default defineNitroConfig({
  storage: {
    cache: {
      driver: '@screeny05/unstorage-driver-redis',
    },
  },
});
```

Nuxt configuration:

```ts
export default defineNuxtConfig({
  nitro: {
    storage: {
      cache: {
        driver: '@screeny05/unstorage-driver-redis',
      },
    },
  },
});
```

## Configuration

This package supports the same configuration options as the [official Redis driver](https://unstorage.unjs.io/drivers/redis#usage).

```ts
export default defineNuxtConfig({
  nitro: {
    storage: {
      cache: {
        url: 'redis://localhost:6379',
        driver: '@screeny05/unstorage-driver-redis',
        enableAutoPipelining: true,
        preConnect: true,
      },
    },
  },
});
```
