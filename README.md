# dynamodb-toolkit-koa [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/dynamodb-toolkit-koa.svg
[npm-url]: https://npmjs.org/package/dynamodb-toolkit-koa

Koa adapter for [`dynamodb-toolkit`](https://github.com/uhop/dynamodb-toolkit) v3. Mounts the toolkit's standard REST route pack as a Koa middleware — same wire contract as `dynamodb-toolkit/handler` (the bundled `node:http` adapter), translated for Koa.

> **Status: scaffolding.** Implementation to follow. The v2 `helpers/KoaAdapter.js` that shipped inside `dynamodb-toolkit@2.3.0` is the structural reference.

## Install

```sh
npm install dynamodb-toolkit-koa dynamodb-toolkit koa @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

`dynamodb-toolkit` and `koa` are declared as **peer dependencies**.

## Quick start

```js
import Koa from 'koa';
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
app.use(createKoaAdapter(adapter));
app.listen(3000);
```

The adapter serves the [standard route pack](https://github.com/uhop/dynamodb-toolkit/wiki/HTTP-handler) — envelope keys, status codes, and prefixes all configurable via `options.policy`.

## Compatibility

- **Koa 2** and **Koa 3** (peer dep range `^2.15.0 || ^3.0.0`).
- **Node 20+**; cross-runtime test matrix (Deno / Bun) TBD — depends on Koa's own compat.

## License

[BSD-3-Clause](LICENSE).
