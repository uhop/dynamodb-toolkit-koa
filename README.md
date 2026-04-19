# dynamodb-toolkit-koa [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/dynamodb-toolkit-koa.svg
[npm-url]: https://npmjs.org/package/dynamodb-toolkit-koa

Koa adapter for [`dynamodb-toolkit`](https://github.com/uhop/dynamodb-toolkit) v3. Mounts the toolkit's standard REST route pack as a Koa middleware — same wire contract as `dynamodb-toolkit/handler` (the bundled `node:http` adapter), translated for Koa's `(ctx, next)` shape.

Zero runtime dependencies; `koa` and `dynamodb-toolkit` are peer dependencies.

## Install

```sh
npm install dynamodb-toolkit-koa dynamodb-toolkit koa @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Quick start

```js
import Koa from 'koa';
import mount from 'koa-mount';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {Adapter} from 'dynamodb-toolkit';
import {createKoaAdapter} from 'dynamodb-toolkit-koa';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({region: 'us-east-1'}));

const adapter = new Adapter({
  client,
  table: 'planets',
  keyFields: ['name']
});

const app = new Koa();
app.use(mount('/planets', createKoaAdapter(adapter)));
app.listen(3000);
```

`koa-mount` (or any upstream that strips the collection prefix from `ctx.path`) is the idiomatic way to mount the adapter at a sub-path. Unrecognized routes hand back to `next()`, so the adapter composes cleanly with the rest of your Koa stack.

## Options

| Option               | Default                                 | Purpose                                                        |
| -------------------- | --------------------------------------- | -------------------------------------------------------------- |
| `policy`             | `defaultPolicy`                         | Partial overrides for prefixes, envelope keys, status codes.   |
| `sortableIndices`    | `{}`                                    | Map sort-field name → GSI name for `?sort=` / `?sort=-field`.  |
| `keyFromPath`        | `(raw, a) => ({[a.keyFields[0]]: raw})` | Convert `:key` path segment to a key object (composite keys).  |
| `exampleFromContext` | `() => ({})`                            | Derive `prepareListInput` `example` from `(query, body, ctx)`. |
| `maxBodyBytes`       | `1048576` (1 MiB)                       | Cap for stream-parsed bodies (ignored when a body-parser ran). |

Consumers using `koa-bodyparser` (or `@koa/bodyparser`) can rely on their pre-parsed `ctx.request.body`; the adapter uses it when set, falls back to streaming the raw request otherwise.

## Routes

Rooted at the mount point:

| Method | Path               | Adapter method                |
| ------ | ------------------ | ----------------------------- |
| GET    | `/`                | `getAll` (envelope + links)   |
| POST   | `/`                | `post`                        |
| DELETE | `/`                | `deleteAllByParams`           |
| GET    | `/-by-names`       | `getByKeys`                   |
| DELETE | `/-by-names`       | `deleteByKeys`                |
| PUT    | `/-load`           | `putAll`                      |
| PUT    | `/-clone`          | `cloneAllByParams` (overlay)  |
| PUT    | `/-move`           | `moveAllByParams` (overlay)   |
| PUT    | `/-clone-by-names` | `cloneByKeys` (overlay)       |
| PUT    | `/-move-by-names`  | `moveByKeys` (overlay)        |
| GET    | `/:key`            | `getByKey`                    |
| PUT    | `/:key`            | `put` (URL key merged in)     |
| PATCH  | `/:key`            | `patch` (meta keys → options) |
| DELETE | `/:key`            | `delete`                      |
| PUT    | `/:key/-clone`     | `clone`                       |
| PUT    | `/:key/-move`      | `move`                        |

Wire contract — query syntax, envelope shape, meta-key prefixes, status codes — matches the bundled [HTTP handler](https://github.com/uhop/dynamodb-toolkit/wiki/HTTP-handler). Everything is configurable through `options.policy`.

## Compatibility

- **Koa 2** and **Koa 3** (peer range `^2.15.0 || ^3.0.0`).
- **Node 20+**, **Bun**, **Deno** — the adapter's tests run cleanly under all three.

## License

[BSD-3-Clause](LICENSE).
