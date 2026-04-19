// dynamodb-toolkit Koa adapter — main entry.
// Translates Koa (req, res) into rest-core parsers + matchRoute + standard route pack.
//
// Design outline (to implement):
//   createKoaAdapter(adapter, options?) → Koa middleware function (ctx, next) => Promise
//     - parse ctx.method + ctx.path via matchRoute
//     - drive ctx.request.body / ctx.query through rest-core parsers
//     - dispatch to the supplied dynamodb-toolkit Adapter
//     - write response via ctx.body / ctx.status using rest-core builders + policy
//
// Reference: helpers/KoaAdapter.js in dynamodb-toolkit@2.3.0 (v2 source).
