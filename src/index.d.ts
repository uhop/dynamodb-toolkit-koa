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
   * Default: `(raw, adp) => ({[adp.keyFields[0]]: raw})` — the raw string
   * becomes the partition key. Override for composite keys (e.g.
   * `${partition}:${sort}` → `{partition, sort}`), numeric coercion, or
   * URL-format validation.
   *
   * @param rawKey The URL-decoded `:key` path segment, always a string.
   * @param adapter The target Adapter. Inspect `adapter.keyFields` to decide
   *   which fields to populate when writing a generic callback.
   * @returns The full key object. Every entry in `adapter.keyFields` must be
   *   a property of the returned object; the return value flows directly
   *   into `adapter.getByKey` / `put` / `patch` / `delete`.
   */
  keyFromPath?: (rawKey: string, adapter: Adapter<TItem>) => Record<string, unknown>;
  /**
   * Build the `example` object passed to `Adapter.prepareListInput` from the
   * current request. Runs on `GET /`, `DELETE /`, and the `PUT /-clone` /
   * `PUT /-move` bulk endpoints — the collection-level routes that invoke
   * the Adapter's list-params machinery.
   *
   * Default: `() => ({})` — no example; `prepareListInput` derives
   * everything from the `index` argument alone.
   *
   * @param query Parsed URL query-string. Array values (repeated keys) have
   *   already been collapsed to the first element.
   * @param body Parsed request body. `null` on `GET /` and `DELETE /`; the
   *   overlay object on `PUT /-clone` / `PUT /-move`.
   * @param ctx The full Koa `Context`. Use it to pull auth info from
   *   upstream middleware (`ctx.state.user.tenantId`), request metadata
   *   (`ctx.headers`, `ctx.ip`), etc.
   * @returns The `example` argument threaded into `Adapter.prepareListInput`.
   *   Typically shapes a `KeyConditionExpression` for a GSI (e.g.
   *   `{tenantId: ctx.state.user.tenantId}` for per-tenant scoping).
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
