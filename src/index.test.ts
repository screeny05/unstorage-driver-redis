import { beforeEach, describe, expect, it, vi } from 'vitest';

import createRedisDriver from './index';

/**
 * `setItems` is the only method this driver adds over the official one, so it is the only one
 * worth covering here. What matters is the commands it builds, not that ioredis can send them.
 */
const h = vi.hoisted(() => {
  const commands: [string, ...unknown[]][] = [];
  const counters = { pipelines: 0, execs: 0 };
  /** Set to make every pipelined command come back with this error, as ioredis does. */
  let pipelineError: Error | null = null;

  const pipeline = {
    set(...args: unknown[]) {
      commands.push(['set', ...args]);
      return pipeline;
    },
    async exec() {
      counters.execs++;
      return commands
        .filter(([name]) => name === 'set')
        .map(() => [pipelineError, 'OK'] as [Error | null, string]);
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

  return {
    commands,
    counters,
    FakeRedis,
    failPipelineWith: (error: Error | null) => {
      pipelineError = error;
    },
  };
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
  h.failPipelineWith(null);
});

describe('setItems with an expiry', () => {
  it('carries the expiry on the write instead of applying it afterwards', async () => {
    await driver({ ttl: 60 }).setItems([item('a'), item('b')]);

    expect(h.commands).toEqual([
      ['set', 'a', 'value-of-a', 'EX', 60],
      ['set', 'b', 'value-of-b', 'EX', 60],
    ]);
    // A key left untimed, even briefly, stays that way if the process dies before EXPIRE lands.
    expect(h.commands.some(([name]) => name === 'mset')).toBe(false);
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

  it('keeps one untimed item out of the expiry, without leaving the pipeline', async () => {
    await driver().setItems([item('a', 30), item('b')]);

    expect(h.commands).toEqual([
      ['set', 'a', 'value-of-a', 'EX', 30],
      ['set', 'b', 'value-of-b'],
    ]);
    expect(h.counters.pipelines).toBe(1);
  });

  it('surfaces a failed write rather than resolving', async () => {
    h.failPipelineWith(new Error('OOM command not allowed'));

    // A pipeline resolves with per-command errors, so this rejects only because they are read.
    await expect(driver({ ttl: 60 }).setItems([item('a')])).rejects.toThrow(
      'OOM command not allowed'
    );
  });
});

describe('setItems without an expiry', () => {
  it('writes the batch as a single MSET', async () => {
    await driver().setItems([item('a'), item('b')]);

    expect(h.commands).toEqual([
      ['mset', 'a', 'value-of-a', 'b', 'value-of-b'],
    ]);
    expect(h.counters.pipelines).toBe(0);
  });

  it('touches redis at all only when there is something to write', async () => {
    await driver({ ttl: 60 }).setItems([]);

    expect(h.commands).toEqual([]);
    expect(h.counters.pipelines).toBe(0);
    expect(h.counters.execs).toBe(0);
  });
});

describe('setItems in cluster mode', () => {
  // Both MSET and pipelines require every key to hash to the same slot.
  const cluster = { cluster: [{ host: '127.0.0.1', port: 6379 }] };

  it('sends individual commands rather than a pipeline or an MSET', async () => {
    await driver({ ...cluster, ttl: 60 }).setItems([item('a'), item('b')]);

    expect(h.commands).toEqual([
      ['set', 'a', 'value-of-a', 'EX', 60],
      ['set', 'b', 'value-of-b', 'EX', 60],
    ]);
    expect(h.counters.pipelines).toBe(0);
  });

  it('still avoids MSET when no expiry applies', async () => {
    await driver(cluster).setItems([item('a'), item('b')]);

    expect(h.commands).toEqual([
      ['set', 'a', 'value-of-a'],
      ['set', 'b', 'value-of-b'],
    ]);
    expect(h.commands.some(([name]) => name === 'mset')).toBe(false);
  });
});

describe('key prefixing', () => {
  it('applies the configured base on both paths', async () => {
    await driver({ base: 'app', ttl: 60 }).setItems([item('a')]);
    expect(h.commands).toEqual([['set', 'app:a', 'value-of-a', 'EX', 60]]);

    h.commands.length = 0;
    await driver({ base: 'app' }).setItems([item('a')]);
    expect(h.commands).toEqual([['mset', 'app:a', 'value-of-a']]);
  });
});
