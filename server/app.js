import express from 'express';
import helmet from 'helmet';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { root, limits } from './config.js';
import { AppError, safeError, redact } from './errors.js';
import { analyze, Confirmations } from './safety.js';
import { withDatabase, diagnose, collectRequest } from './database.js';
import { catalog, objectInfo, tableData, mutate } from './catalog.js';

const identifier = z.string().min(1).max(128);
const objectShape = { schema: identifier, name: identifier };
const value = z.union([z.string().max(16384), z.number().finite(), z.boolean(), z.null()]);
const dataSchema = z.object({
  ...objectShape,
  page: z.number().int().min(0).max(1000000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
  sort: z.string().max(128).optional(),
  direction: z.enum(['ASC', 'DESC']).default('ASC'),
  filters: z
    .array(
      z.object({
        column: identifier,
        operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'isNull', 'notNull']),
        value: value.optional(),
      }),
    )
    .max(10)
    .default([]),
});
const mutationSchema = z.object({
  ...objectShape,
  action: z.enum(['insert', 'update', 'delete']),
  values: z.record(z.string(), value).default({}),
  original: z.record(z.string(), value).optional(),
});
const querySchema = z.object({
  sql: z.string().min(1).max(100000),
  id: z.string().uuid().optional(),
  confirmationToken: z.string().optional(),
});

export function createApp(overrides = {}) {
  const db = {
    withDatabase,
    diagnose,
    collectRequest,
    catalog,
    objectInfo,
    tableData,
    mutate,
    ...overrides,
  };
  const app = express(),
    csrf = randomBytes(32).toString('hex'),
    confirmations = new Confirmations(),
    active = new Map(),
    history = [];
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
      return res.status(403).json({ error: { message: 'Use the local Workbench address.' } });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`)
      return res.status(403).json({ error: { message: 'Cross-origin requests are not allowed.' } });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return res.status(403).json({ error: { message: 'Cross-site requests are not allowed.' } });
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const original = res.json.bind(res);
    res.json = (body) => original(redact(body));
    if (req.path === '/session' && req.method === 'GET')
      return res.json({ token: csrf, limits: limits() });
    if (req.headers['x-dbms-token'] !== csrf)
      return res
        .status(403)
        .json({
          error: { category: 'security', message: 'Your local session expired. Reload the page.' },
        });
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
  app.get(
    '/api/connection',
    route(async (req, res) => res.json(await db.diagnose())),
  );
  app.get(
    '/api/catalog',
    route(async (req, res) => res.json(await db.withDatabase(db.catalog))),
  );
  app.get(
    '/api/object',
    route(async (req, res) => {
      const p = z.object(objectShape).parse(req.query);
      res.json(await db.withDatabase((pool) => db.objectInfo(pool, p.schema, p.name)));
    }),
  );
  app.post(
    '/api/data',
    route(async (req, res) => {
      const p = dataSchema.parse(req.body);
      res.json(await db.withDatabase((pool) => db.tableData(pool, p)));
    }),
  );
  app.post(
    '/api/query/prepare',
    route(async (req, res) => {
      const p = querySchema.parse(req.body),
        safety = analyze(p.sql);
      res.json({
        ...safety,
        confirmationToken: safety.requiresConfirmation
          ? confirmations.issue({ kind: 'query', sql: p.sql })
          : undefined,
      });
    }),
  );
  app.post(
    '/api/query/run',
    route(async (req, res) => {
      const p = querySchema.parse(req.body),
        safety = analyze(p.sql);
      if (safety.requiresConfirmation)
        confirmations.consume(p.confirmationToken, { kind: 'query', sql: p.sql });
      if (active.size)
        throw new AppError(
          'A query is already running. Cancel it or wait for completion.',
          'busy',
          409,
        );
      const id = p.id || randomUUID(),
        state = { request: null, cancelled: false };
      active.set(id, state);
      const started = Date.now();
      const entry = { id, sql: p.sql, startedAt: new Date().toISOString(), status: 'running' };
      const cancel = () => {
        if (!res.writableEnded) {
          state.cancelled = true;
          state.request?.cancel();
        }
      };
      res.on('close', cancel);
      try {
        const result = await db.withDatabase(async (pool) => {
          if (state.cancelled)
            throw new AppError('Query cancelled before execution.', 'cancelled', 409);
          // Bound large variable-length columns before the driver buffers them.
          await pool.request().query('SET TEXTSIZE 32768; SET NOCOUNT OFF;');
          if (state.cancelled)
            throw new AppError('Query cancelled before execution.', 'cancelled', 409);
          return db.collectRequest(pool.request(), p.sql, limits(), (request) => {
            state.request = request;
            if (state.cancelled) request.cancel();
          });
        });
        Object.assign(entry, {
          status: 'success',
          elapsedMs: result.elapsedMs,
          rowCount: result.rowCount,
          rowCounts: result.rowCounts,
        });
        res.json({ id, ...result, limits: limits() });
      } catch (e) {
        Object.assign(entry, {
          status: 'failed',
          elapsedMs: Date.now() - started,
          error: safeError(e),
        });
        throw e;
      } finally {
        active.delete(id);
        res.off('close', cancel);
        history.unshift(redact(entry));
        history.splice(50);
      }
    }),
  );
  app.post(
    '/api/query/cancel',
    route(async (req, res) => {
      const id = z.string().uuid().parse(req.body.id),
        state = active.get(id);
      if (state) {
        state.cancelled = true;
        state.request?.cancel();
      }
      res.json({ cancelRequested: !!state });
    }),
  );
  app.get('/api/history', (req, res) => res.json({ history }));
  app.delete('/api/history', (req, res) => {
    history.length = 0;
    res.json({ cleared: true });
  });
  app.post(
    '/api/mutation/prepare',
    route(async (req, res) => {
      const p = mutationSchema.parse(req.body);
      res.json({
        confirmationToken: confirmations.issue({ kind: 'mutation', payload: p }),
        warnings: [
          p.action === 'delete'
            ? 'This permanently deletes the selected row. Foreign-key cascade rules and triggers may affect other rows.'
            : 'This writes the selected values to the database. Triggers and constraints apply.',
          'The change uses your configured database account’s permissions.',
        ],
      });
    }),
  );
  app.post(
    '/api/mutation/run',
    route(async (req, res) => {
      const p = mutationSchema.parse(req.body);
      confirmations.consume(req.body.confirmationToken, { kind: 'mutation', payload: p });
      res.json(await db.withDatabase((pool) => db.mutate(pool, p)));
    }),
  );
  app.use('/api', (req, res) => res.status(404).json({ error: { message: 'Unknown API route.' } }));
  app.use(express.static(path.join(root, 'dist'), { dotfiles: 'deny' }));
  app.get('/', (req, res) =>
    res
      .status(503)
      .type('text')
      .send('Build the interface with npm run build, then restart the server.'),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({
          error: {
            category: 'validation',
            message:
              'The request contains missing or invalid fields. Refresh the page and check your inputs.',
          },
        });
    if (error.type === 'entity.too.large')
      return res
        .status(413)
        .json({
          error: { category: 'validation', message: 'The request exceeds the 256 KB limit.' },
        });
    res.status(error.status || 400).json({ error: safeError(error) });
  });
  return app;
}
