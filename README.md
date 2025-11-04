# @screeny05/unstorage-driver-redis

Provides an [unstorage](https://unstorage.unjs.io/) driver which uses [ioredis](https://github.com/redis/ioredis) to store data.

This code is extracted from the [official unstorage driver](https://github.com/unjs/unstorage/blob/v1.17.2/src/drivers/redis.ts) for Redis with some slight modifications added:

- Support for setItems natively, running `mset` and a pipeline for `expire` for better performance

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
