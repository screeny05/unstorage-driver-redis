import { defineDriver, joinKeys } from 'unstorage';

import Redis, {
  Cluster,
  type ClusterNode,
  type ClusterOptions,
  type RedisOptions as _RedisOptions,
} from 'ioredis';

export interface RedisOptions extends _RedisOptions {
  /**
   * Optional prefix to use for all keys. Can be used for namespacing.
   */
  base?: string;

  /**
   * Url to use for connecting to redis. Takes precedence over `host` option. Has the format `redis://<REDIS_USER>:<REDIS_PASSWORD>@<REDIS_HOST>:<REDIS_PORT>`
   */
  url?: string;

  /**
   * List of redis nodes to use for cluster mode. Takes precedence over `url` and `host` options.
   */
  cluster?: ClusterNode[];

  /**
   * Options to use for cluster mode.
   */
  clusterOptions?: ClusterOptions;

  /**
   * Default TTL for all items in seconds.
   */
  ttl?: number;

  /**
   * How many keys to scan at once.
   *
   * [redis documentation](https://redis.io/docs/latest/commands/scan/#the-count-option)
   */
  scanCount?: number;

  /**
   * Whether to initialize the redis instance immediately.
   * Otherwise, it will be initialized on the first read/write call.
   * @default false
   */
  preConnect?: boolean;
}

const DRIVER_NAME = 'redis';

export default defineDriver((opts: RedisOptions) => {
  let redisClient: Redis | Cluster;
  const getRedisClient = () => {
    if (redisClient) {
      return redisClient;
    }
    if (opts.cluster) {
      redisClient = new Redis.Cluster(opts.cluster, opts.clusterOptions);
    } else if (opts.url) {
      redisClient = new Redis(opts.url, opts);
    } else {
      redisClient = new Redis(opts);
    }
    return redisClient;
  };

  const base = (opts.base || '').replace(/:$/, '');
  const p = (...keys: string[]) => joinKeys(base, ...keys); // Prefix a key. Uses base for backwards compatibility
  const d = (key: string) => (base ? key.replace(`${base}:`, '') : key); // Deprefix a key

  if (opts.preConnect) {
    try {
      getRedisClient();
    } catch (error) {
      console.error(error);
    }
  }

  const scan = async (pattern: string): Promise<string[]> => {
    const client = getRedisClient();
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, scanKeys] =
        opts.scanCount ?
          await client.scan(cursor, 'MATCH', pattern, 'COUNT', opts.scanCount)
        : await client.scan(cursor, 'MATCH', pattern);
      cursor = nextCursor;
      keys.push(...scanKeys);
    } while (cursor !== '0');
    return keys;
  };

  return {
    name: DRIVER_NAME,
    options: opts,
    getInstance: getRedisClient,
    async hasItem(key) {
      return Boolean(await getRedisClient().exists(p(key)));
    },
    async getItem(key) {
      const value = await getRedisClient().get(p(key));
      return value ?? null;
    },
    async getItems(items) {
      const keys = items.map(item => p(item.key));
      const data = await getRedisClient().mget(...keys);

      return keys.map((key, index) => {
        return {
          key: d(key),
          value: data[index] ?? null,
        };
      });
    },
    async setItem(key, value, tOptions) {
      const ttl = tOptions?.ttl ?? opts.ttl;
      if (ttl) {
        await getRedisClient().set(p(key), value, 'EX', ttl);
      } else {
        await getRedisClient().set(p(key), value);
      }
    },
    async setItems(items, commonOptions) {
      if (items.length === 0) {
        return;
      }

      const client = getRedisClient();
      const defaultTtl = commonOptions?.ttl ?? opts.ttl;
      const getTtl = (item: (typeof items)[number]) =>
        item.options?.ttl ?? defaultTtl;

      // In cluster mode both `MSET` and pipelines require every key to hash to the same slot, so
      // send individual `SET` commands (mirroring `setItem`).
      if (opts.cluster) {
        await Promise.all(
          items.map(item => {
            const ttl = getTtl(item);
            return ttl ?
                client.set(p(item.key), item.value, 'EX', ttl)
              : client.set(p(item.key), item.value);
          })
        );
        return;
      }

      // `MSET` cannot carry a per-key TTL. Where one applies, write each item as `SET ... EX` in a
      // pipeline instead: `MSET` followed by `EXPIRE` would leave every key untimed until the
      // second round trip lands, and a process that dies in that window — or a serverless isolate
      // that freezes after responding — leaves them that way for good.
      const hasTtl = defaultTtl || items.some(item => item.options?.ttl);
      if (hasTtl) {
        const pipeline = client.pipeline();
        for (const item of items) {
          const ttl = getTtl(item);
          if (ttl) {
            pipeline.set(p(item.key), item.value, 'EX', ttl);
          } else {
            pipeline.set(p(item.key), item.value);
          }
        }
        // A pipeline resolves with per-command errors rather than rejecting, so a failed write is
        // silent unless it is looked for.
        const results = await pipeline.exec();
        const error = results?.find(([error]) => error)?.[0];
        if (error) {
          throw error;
        }
        return;
      }

      // Nothing needs an expiry, so the whole batch is one command.
      const args: string[] = [];
      for (const item of items) {
        args.push(p(item.key), item.value);
      }
      await client.mset(...args);
    },
    async removeItem(key) {
      await getRedisClient().unlink(p(key));
    },
    async getKeys(base) {
      const keys = await scan(p(base, '*'));
      return keys.map(key => d(key));
    },
    async clear(base) {
      const keys = await scan(p(base, '*'));
      if (keys.length === 0) {
        return;
      }
      await getRedisClient().unlink(keys);
    },
    dispose() {
      return getRedisClient().disconnect();
    },
  };
});
