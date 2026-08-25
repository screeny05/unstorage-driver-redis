# @screeny05/unstorage-driver-redis

Provides an [unstorage](https://unstorage.unjs.io/) driver which uses [ioredis](https://github.com/redis/ioredis) to store data.

The [official driver](https://github.com/unjs/unstorage/blob/v1.17.2/src/drivers/redis.ts) gained
`setItems` in [unstorage#782](https://github.com/unjs/unstorage/pull/782), which is on `2.0.0-alpha`
and in no 1.x release. This package backports it: unstorage 1.17's driver plus that method. Without
it unstorage falls back to one `setItem` call per item.

`setItems` writes the batch as a single `MSET`, or as a pipeline of `SET ... EX` when a TTL applies
— `MSET` cannot carry a per-key TTL, and applying `EXPIRE` afterwards would leave the keys untimed
in between. Cluster mode sends individual commands, since `MSET` and pipelines both need one slot.

**Once unstorage 2 is stable and your framework uses it, drop this package for `driver: 'redis'`.**

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
