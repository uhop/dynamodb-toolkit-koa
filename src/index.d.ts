import type {Context, Middleware} from 'koa';

import type {Adapter} from 'dynamodb-toolkit';
import type {RestPolicy} from 'dynamodb-toolkit/rest-core';

/** Options for {@link createKoaAdapter}. */
export interface KoaAdapterOptions<TItem extends Record<string, unknown> = Record<string, unknown>> {
  /** Partial overrides for the REST policy (merged with the default). */
  policy?: Partial<RestPolicy>;
  /**
   * Map from sort-field name to the GSI index that provides that ordering.
   * `?sort=name` becomes `{index: sortableIndices.name, descending: false}`.
   */
  sortableIndices?: Record<string, string>;
  /**
   * Convert the URL `:key` segment into a key object. Runs on every keyed
   * route (`GET /:key`, `PUT /:key`, `PATCH /:key`, `DELETE /:key`, and the
   * single-item `-clone` / `-move` endpoints).
   *
   * - `rawKey` — the URL-decoded `:key` path segment, string.
   * - `adapter` — the target Adapter; use `adapter.keyFields` to decide what
   *   to populate for composite keys.
   *
   * Return a full key object. Default: `(raw, adp) => ({[adp.keyFields[0]]: raw})`.
   */
  keyFromPath?: (rawKey: string, adapter: Adapter<TItem>) => Record<string, unknown>;
  /**
   * Build the `example` object passed to `Adapter.prepareListInput` from the
   * current request. Runs on `GET /`, `DELETE /`, and the `-clone` / `-move`
   * bulk endpoints.
   *
   * - `query` — parsed query-string object, `Record<string, string>`.
   * - `body` — parsed request body, `unknown` (null on GET/DELETE).
   * - `ctx`   — the full Koa `Context`; useful for pulling auth info from
   *   upstream middleware (e.g. `ctx.state.user.tenantId`).
   *
   * Default: `() => ({})`.
   */
  exampleFromContext?: (query: Record<string, string>, body: unknown, ctx: Context) => Record<string, unknown>;
  /**
   * Cap for the raw request body in bytes. Enforced only when the consumer
   * has not pre-parsed the body (i.e. `ctx.request.body` is `undefined`). If
   * a Koa body-parser is in the chain, that parser's cap applies instead.
   *
   * Default: `1048576` (1 MiB), matching the bundled `node:http` handler.
   */
  maxBodyBytes?: number;
}

/**
 * Build a Koa middleware that serves the standard dynamodb-toolkit REST
 * route pack against the supplied Adapter. Mount with `koa-mount` (or another
 * prefix-stripping mechanism) so `ctx.path` is relative to the collection
 * root.
 *
 * Routes (all rooted at the mount point):
 * - `GET/POST/DELETE /` — getAll / post / deleteAllByParams
 * - `GET /-by-names`, `DELETE /-by-names` — getByKeys / deleteByKeys
 * - `PUT /-load` — bulk putAll
 * - `PUT /-clone`, `PUT /-move` — cloneAllByParams / moveAllByParams (body is overlay)
 * - `PUT /-clone-by-names`, `PUT /-move-by-names` — cloneByKeys / moveByKeys
 * - `GET/PUT/PATCH/DELETE /:key` — getByKey / put / patch / delete
 * - `PUT /:key/-clone`, `PUT /:key/-move` — single-item clone / move
 *
 * Dispatch behavior:
 * - Unrecognized route shape → `await next()` — other middleware can respond.
 * - Known shape, unsupported method → `405 Method Not Allowed`.
 * - Thrown errors map through `policy.errorBody` + `mapErrorStatus` into a
 *   JSON body plus the matching status code.
 *
 * @param adapter The dynamodb-toolkit Adapter that performs the DynamoDB work.
 * @param options Policy, sortable indices, key / example extractors, body cap.
 * @returns A Koa `Middleware` suitable for `app.use` or `mount('/planets', ...)`.
 */
export function createKoaAdapter<TItem extends Record<string, unknown> = Record<string, unknown>>(
  adapter: Adapter<TItem>,
  options?: KoaAdapterOptions<TItem>
): Middleware;
