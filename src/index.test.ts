import { beforeEach, describe, expect, it, vi } from 'vitest';

import createRedisDriver from './index';

/**
 * `setItems` is the only method this driver adds over the official one, so it is the only one
 * worth covering here. What matters is the commands it builds, not that ioredis can send them.
 */
const h = vi.hoisted(() => {
  const commands: [string, ...unknown[]][] = [];
  const counters = { pipelines: 0, execs: 0 };

  const pipeline = {
    set(...args: unknown[]) {
      commands.push(['set', ...args]);
      return pipeline;
    },
    expire(...args: unknown[]) {
      commands.push(['expire', ...args]);
      return pipeline;
    },
    async exec() {
      counters.execs++;
      return [];
    },
  };

  class FakeRedis {
    pipeline() {
      counters.pipelines++;
      return pipeline;
    }
    async mset(...args: unknown[]) {
      commands.push(['mset', ...args]);
    }
    async set(...args: unknown[]) {
      commands.push(['set', ...args]);
    }
  }

  return { commands, counters, FakeRedis };
});

vi.mock('ioredis', () => {
  const Redis = h.FakeRedis as unknown as { Cluster: unknown };
  Redis.Cluster = h.FakeRedis;
  return { default: Redis, Cluster: h.FakeRedis };
});

const driver = (opts: Record<string, unknown> = {}) =>
  createRedisDriver({ host: '127.0.0.1', ...opts } as never) as unknown as {
    setItems: (
      items: { key: string; value: string; options?: { ttl?: number } }[],
      commonOptions?: { ttl?: number }
    ) => Promise<void>;
  };

const item = (key: string, ttl?: number) => ({
  key,
  value: `value-of-${key}`,
  options: ttl === undefined ? undefined : { ttl },
});

beforeEach(() => {
  h.commands.length = 0;
  h.counters.pipelines = 0;
  h.counters.execs = 0;
});

describe('setItems', () => {
  it('carries the expiry on the write instead of applying it afterwards', async () => {
    await driver({ ttl: 60 }).setItems([item('a'), item('b')]);

    expect(h.commands).toEqual([
      ['set', 'a', 'value-of-a', 'EX', 60],
      ['set', 'b', 'value-of-b', 'EX', 60],
    ]);
    // A key that exists untimed, even briefly, survives a process that dies before EXPIRE lands.
    expect(
      h.commands.some(([name]) => name === 'mset' || name === 'expire')
    ).toBe(false);
  });

  it('sends the whole batch as one pipeline', async () => {
    await driver({ ttl: 60 }).setItems([item('a'), item('b'), item('c')]);

    expect(h.counters.pipelines).toBe(1);
    expect(h.counters.execs).toBe(1);
  });

  it('prefers an item ttl over the common one, and the common one over the driver default', async () => {
    await driver({ ttl: 10 }).setItems([item('a', 99), item('b')], { ttl: 50 });

    expect(h.commands).toEqual([
      ['set', 'a', 'value-of-a', 'EX', 99],
      ['set', 'b', 'value-of-b', 'EX', 50],
    ]);
  });

  it('writes without an expiry when no ttl is configured anywhere', async () => {
    await driver().setItems([item('a')]);

    expect(h.commands).toEqual([['set', 'a', 'value-of-a']]);
  });

  it('mixes timed and untimed items in one pipeline', async () => {
    await driver().setItems([item('a', 30), item('b')]);

    expect(h.commands).toEqual([
      ['set', 'a', 'value-of-a', 'EX', 30],
      ['set', 'b', 'value-of-b'],
    ]);
    expect(h.counters.pipelines).toBe(1);
  });

  it('touches redis at all only when there is something to write', async () => {
    await driver({ ttl: 60 }).setItems([]);

    expect(h.counters.pipelines).toBe(0);
    expect(h.counters.execs).toBe(0);
  });

  it('prefixes keys with the configured base', async () => {
    await driver({ base: 'app', ttl: 60 }).setItems([item('a')]);

    expect(h.commands).toEqual([['set', 'app:a', 'value-of-a', 'EX', 60]]);
  });
});
