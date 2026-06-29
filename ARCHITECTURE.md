# Architecture — dynamodb-toolkit-koa

Internal layout and design notes for maintainers. Consumer-facing docs live in the [wiki](https://github.com/uhop/dynamodb-toolkit-koa/wiki); the machine-readable API reference is in `llms.txt` / `llms-full.txt`.

## Shape

ESM-only JavaScript with a hand-written `.d.ts` sidecar next to every `.js` — no build step, no transpiler. Zero runtime dependencies; `dynamodb-toolkit` and `koa` are the only peer dependencies (`koa` spans `^2.15.0 || ^3.0.0` — the adapter touches only properties present in both). Each `.js` opens with a `// @ts-self-types="./<file>.d.ts"` directive so its sibling `.d.ts` is the sole source of types and docs; `.js` files hold no JSDoc beyond the load-bearing inline `/** @type */` annotations the implementation needs to type-check (the `ListOptions` and write-body casts in `index.js`).

A Koa adapter, not a framework. All parsing, envelope building, policy merging, and route-shape matching are delegated to the parent toolkit; this package owns only the `(ctx, next)` translation and error mapping.

## Composition

`createKoaAdapter(adapter, options)` is the single public entry. It closes over the merged `policy`, `sortableIndices`, `keyFromPath` / `exampleFromContext` extractors, and `maxBodyBytes`, then returns one `(ctx, next)` Koa middleware. The returned function is the whole runtime surface — there is no per-request object construction beyond the closures.

Delegation targets in the parent:

| Import                                                                                                                                                                             | Responsibility                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `dynamodb-toolkit/rest-core` (`parse*`, `build*`, `mergePolicy`, `mapErrorStatus`, `resolveSort`, `buildListOptions`, `coerceStringQuery`, `validateWriteBody`, `paginationLinks`) | Framework-agnostic REST primitives — parsers, builders, policy, query coercion, DoS gates. |
| `dynamodb-toolkit/handler` (`matchRoute`, `readJsonBody`)                                                                                                                          | Route-shape matching (`HEAD → GET` auto-promote) and the Node-stream JSON body reader.     |
| consumer-supplied `Adapter`                                                                                                                                                        | The DynamoDB layer — `getList` / `getByKey` / `put` / `patch` / mass ops.                  |

The streaming body reader **is** imported from the parent — `readJsonBody` works on the raw Node `IncomingMessage` (`ctx.req`), which Koa exposes unwrapped. It is called with `{destroy: false}` so an over-cap request still gets a written `413` instead of a socket reset.

## Dispatch

The returned middleware coerces the query (`coerceStringQuery` — first value wins per repeated key, matching express / fetch / lambda), then `matchRoute(ctx.method, ctx.path, policy.methodPrefix)` classifies the request into one of four `route.kind` buckets:

- `root` — `GET` / `POST` / `DELETE /` → list / post / `deleteListByParams`.
- `collectionMethod` — the `-by-names`, `-load`, `-clone` / `-move`, `-clone-by-names` / `-move-by-names` endpoints.
- `item` — `GET` / `PUT` / `PATCH` / `DELETE /:key` (the `:key` segment runs through `keyFromPath`).
- `itemMethod` — single-item `PUT /:key/-clone`, `PUT /:key/-move`.

Two non-handler outcomes:

- **Unknown route shape** → `await next()`. The adapter never owns paths it doesn't recognize, so Koa's middleware chain (a custom route, or Koa's default `404`) gets a chance to respond. This is why mounting matters — see Mounting below.
- **Known shape, unsupported method** → explicit `405 Method Not Allowed`.

## Request handling

- **Body** — `getBody` prefers a pre-parsed `ctx.request.body` (any `koa-bodyparser` / `@koa/bodyparser` in the chain); when absent it streams `ctx.req` through the parent's `readJsonBody` with the `maxBodyBytes` cap (1 MiB default). `maxBodyBytes` is therefore ignored when an upstream parser ran — that parser's own cap applies instead. The cap is measured in bytes by the extracted reader, not UTF-16 code units as the 0.1.x variant did.
- **Responses** — `sendJson(ctx, status, body)` for bodies; `sendNoContent(ctx, status)` always assigns `ctx.body = ''`, never `null`. Koa coerces `ctx.body === null` into a `204` even when the status was explicitly set to `404` / `410`, so the empty string is load-bearing: it preserves the chosen status and still ships an empty body. `sendError` maps through `policy.errorBody` + `mapErrorStatus`, honoring an explicit `err.status` in the 4xx/5xx range. The adapter catches in an outer `try/catch` and never re-throws, so Koa's default `ctx.onerror` envelope never fires — the adapter's error body is authoritative.
- **Pagination** — `urlBuilderFor` builds links off `ctx.originalUrl` (the pre-rewrite path+query), not `ctx.url`. Under `koa-mount` Koa rewrites `ctx.path` / `ctx.url` to be relative to the mount point but leaves `ctx.originalUrl` intact, so next/prev links point back at the full public URL the client actually hit.

## Mounting

The adapter accepts no `prefix` option. Consumers strip their collection prefix with `koa-mount` (or by nesting under `@koa/router`) so the adapter sees `ctx.path` relative to the collection root. A top-level `app.use(createKoaAdapter(...))` only works for a single-collection app with no prefix; anything mounted at `/planets` needs `mount('/planets', adapter)` or the adapter classifies `/planets/earth` as a two-segment unknown shape and falls through to `next()`.

The wire contract — routes, envelope, status codes, option shape — matches the bundled `node:http` handler (`dynamodb-toolkit/handler`) and the sibling `dynamodb-toolkit-express` / `dynamodb-toolkit-fetch` / `dynamodb-toolkit-lambda` adapters; only the I/O translation differs.

## Layout

```
src/
  index.js            # createKoaAdapter — the single middleware factory
  index.d.ts          # Type + doc sidecar (sole source of types and docs)
tests/                # Unit + mock-based tests (tape-six); real Koa + fetch harness
  helpers/            # makeMockAdapter + withKoaServer
llms.txt              # Machine-readable API reference (consumer-facing)
llms-full.txt
wiki/                 # Published wiki — git submodule
```

The published tarball ships `src/`, `README.md`, `LICENSE`, `llms.txt`, `llms-full.txt`, `package.json`. Tests, AI-rule files, and the wiki stay out (verify via `npm pack --dry-run`).
