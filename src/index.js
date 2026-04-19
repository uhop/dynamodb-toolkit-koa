// Koa adapter for dynamodb-toolkit v3.
//
// Translates Koa `(ctx, next)` into the toolkit's framework-agnostic pieces:
//   - matchRoute (dynamodb-toolkit/handler) for route-shape recognition
//   - parsers / builders / policy (dynamodb-toolkit/rest-core) for wire format
//   - a consumer-supplied Adapter for the DynamoDB layer
//
// Wire contract matches the bundled node:http handler (dynamodb-toolkit/handler):
// same routes, same envelope, same status codes, same option shape — just
// translated for `ctx` I/O so downstream Koa middleware sees a well-formed
// response it can transform (koa-compress, koa-conditional-get, loggers, etc).

import {
  parseFields,
  parseSort,
  parseFilter,
  parsePatch,
  parseNames,
  parsePaging,
  parseFlag,
  buildEnvelope,
  paginationLinks,
  mergePolicy,
  mapErrorStatus
} from 'dynamodb-toolkit/rest-core';
import {matchRoute} from 'dynamodb-toolkit/handler';

import {readJsonBody} from './read-body.js';

// Koa's ctx.query values are string | string[]; rest-core parsers expect string.
// Collapse arrays to the first element — matches how new URLSearchParams treats
// repeated keys when the caller reads via URLSearchParams.get (vs getAll).
const coerceStringQuery = query => {
  const out = {};
  for (const k of Object.keys(query)) {
    const v = query[k];
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
};

// Prefer a pre-parsed body (koa-bodyparser, @koa/bodyparser, koa-body…). Fall
// back to streaming the raw Node request with our own cap. Pre-parsed bodies
// bypass maxBodyBytes — the body parser is expected to enforce its own cap.
const getBody = async (ctx, maxBodyBytes) => {
  if (ctx.request && ctx.request.body !== undefined) return ctx.request.body;
  return readJsonBody(ctx.req, maxBodyBytes);
};

export const createKoaAdapter = (adapter, options = {}) => {
  const policy = mergePolicy(options.policy);
  const sortableIndices = options.sortableIndices || {};
  const keyFromPath = options.keyFromPath || ((rawKey, adp) => ({[adp.keyFields[0]]: rawKey}));
  const exampleFromContext = options.exampleFromContext || (() => ({}));
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  const buildListOptions = query => {
    const fields = parseFields(query.fields);
    const filter = parseFilter(query.filter);
    const paging = parsePaging(query, {defaultLimit: policy.defaultLimit, maxLimit: policy.maxLimit});
    const consistent = parseFlag(query.consistent);
    /** @type {import('dynamodb-toolkit').ListOptions} */
    const out = {...paging, consistent, needTotal: policy.needTotal};
    if (fields) out.fields = fields;
    if (filter) out.filter = filter.query;
    return out;
  };

  const resolveSort = query => {
    const sort = parseSort(query.sort);
    if (!sort) return {index: undefined, descending: false};
    return {index: sortableIndices[sort.field], descending: sort.direction === 'desc'};
  };

  const sendError = (ctx, err) => {
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : mapErrorStatus(err, policy.statusCodes);
    ctx.status = status;
    ctx.body = policy.errorBody(err);
  };

  const sendJson = (ctx, status, body) => {
    ctx.status = status;
    ctx.body = body;
  };

  // Koa coerces ctx.body === null into a 204 when the current status isn't
  // already in the empty-body set, which would clobber a 404/410/etc. An
  // empty string keeps our chosen status and produces an empty body.
  const sendNoContent = (ctx, status = 204) => {
    ctx.status = status;
    ctx.body = '';
  };

  const urlBuilderFor = ctx => {
    // ctx.originalUrl is the full path+query as received (before any upstream
    // middleware rewrote ctx.url). Building pagination links off it means the
    // next/prev URLs point back at the same endpoint the client hit.
    const base = new URL(ctx.originalUrl || ctx.url || '/', 'http://local');
    return ({offset, limit}) => {
      const u = new URL(base);
      u.searchParams.set('offset', String(offset));
      u.searchParams.set('limit', String(limit));
      return u.pathname + u.search;
    };
  };

  // --- collection-level handlers ---

  const handleGetAll = async (ctx, query) => {
    const opts = buildListOptions(query);
    const {index, descending} = resolveSort(query);
    if (descending) opts.descending = true;
    const example = exampleFromContext(query, null, ctx);
    const result = await adapter.getAll(opts, example, index);

    const links = paginationLinks(result.offset, result.limit, result.total, urlBuilderFor(ctx));
    const envelopeOpts = {keys: policy.envelope};
    if (links.prev || links.next) envelopeOpts.links = links;
    sendJson(ctx, 200, buildEnvelope(result, envelopeOpts));
  };

  const handlePost = async ctx => {
    const body = await getBody(ctx, maxBodyBytes);
    await adapter.post(body);
    sendNoContent(ctx);
  };

  const handleDeleteAll = async (ctx, query) => {
    const opts = buildListOptions(query);
    const {index} = resolveSort(query);
    const example = exampleFromContext(query, null, ctx);
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.deleteAllByParams(params);
    sendJson(ctx, 200, {processed: r.processed});
  };

  // --- /-by-names handlers ---

  const handleGetByNames = async (ctx, query) => {
    const names = parseNames(query.names);
    const fields = parseFields(query.fields);
    const consistent = parseFlag(query.consistent);
    const keys = names.map(name => keyFromPath(name, adapter));
    const items = await adapter.getByKeys(keys, fields, {consistent});
    sendJson(ctx, 200, items);
  };

  const handleDeleteByNames = async (ctx, query) => {
    const namesQ = parseNames(query.names);
    let names = namesQ;
    if (!names.length) {
      const body = await getBody(ctx, maxBodyBytes);
      if (Array.isArray(body)) names = body.map(s => String(s));
    }
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.deleteByKeys(keys);
    sendJson(ctx, 200, {processed: r.processed});
  };

  const handleCloneByNames = async (ctx, query) => {
    const namesQ = parseNames(query.names);
    const body = await getBody(ctx, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.cloneByKeys(keys, item => ({...item, ...overlay}));
    sendJson(ctx, 200, {processed: r.processed});
  };

  const handleMoveByNames = async (ctx, query) => {
    const namesQ = parseNames(query.names);
    const body = await getBody(ctx, maxBodyBytes);
    let names = namesQ;
    if (!names.length && Array.isArray(body)) names = body.map(s => String(s));
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = names.map(name => keyFromPath(name, adapter));
    const r = await adapter.moveByKeys(keys, item => ({...item, ...overlay}));
    sendJson(ctx, 200, {processed: r.processed});
  };

  const handleLoad = async ctx => {
    const body = await getBody(ctx, maxBodyBytes);
    if (!Array.isArray(body)) {
      return sendError(ctx, Object.assign(new Error('Body must be an array of items'), {status: 400, code: 'BadLoadBody'}));
    }
    const r = await adapter.putAll(body);
    sendJson(ctx, 200, {processed: r.processed});
  };

  const handleCloneAll = async (ctx, query) => {
    const body = await getBody(ctx, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const opts = buildListOptions(query);
    const {index} = resolveSort(query);
    const example = exampleFromContext(query, body, ctx);
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.cloneAllByParams(params, item => ({...item, ...overlay}));
    sendJson(ctx, 200, {processed: r.processed});
  };

  const handleMoveAll = async (ctx, query) => {
    const body = await getBody(ctx, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const opts = buildListOptions(query);
    const {index} = resolveSort(query);
    const example = exampleFromContext(query, body, ctx);
    const params = await adapter._buildListParams(opts, false, example, index);
    const r = await adapter.moveAllByParams(params, item => ({...item, ...overlay}));
    sendJson(ctx, 200, {processed: r.processed});
  };

  // --- item-level handlers ---

  const handleItemGet = async (ctx, key, query) => {
    const fields = parseFields(query.fields);
    const consistent = parseFlag(query.consistent);
    const item = await adapter.getByKey(key, fields, {consistent});
    if (item === undefined) return sendNoContent(ctx, policy.statusCodes.miss);
    sendJson(ctx, 200, item);
  };

  const handleItemPut = async (ctx, key, query) => {
    const body = await getBody(ctx, maxBodyBytes);
    const force = parseFlag(query.force);
    const merged = {...body, ...key};
    await adapter.put(merged, {force});
    sendNoContent(ctx);
  };

  const handleItemPatch = async (ctx, key) => {
    const body = await getBody(ctx, maxBodyBytes);
    const {patch, options: patchOptions} = parsePatch(body, {metaPrefix: policy.metaPrefix});
    await adapter.patch(key, patch, patchOptions);
    sendNoContent(ctx);
  };

  const handleItemDelete = async (ctx, key) => {
    await adapter.delete(key);
    sendNoContent(ctx);
  };

  const handleItemClone = async (ctx, key, query) => {
    const body = await getBody(ctx, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.clone(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return sendNoContent(ctx, policy.statusCodes.miss);
    sendNoContent(ctx);
  };

  const handleItemMove = async (ctx, key, query) => {
    const body = await getBody(ctx, maxBodyBytes);
    const overlay = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const force = parseFlag(query.force);
    const result = await adapter.move(key, item => ({...item, ...overlay}), {force});
    if (result === undefined) return sendNoContent(ctx, policy.statusCodes.miss);
    sendNoContent(ctx);
  };

  return async (ctx, next) => {
    const query = coerceStringQuery(ctx.query);
    const route = matchRoute(ctx.method, ctx.path, policy.methodPrefix);

    // Unknown route shape — hand back to the Koa middleware chain so other
    // handlers (or Koa's default 404) can respond.
    if (route.kind === 'unknown') return next();

    try {
      switch (route.kind) {
        case 'root':
          if (route.method === 'GET') return await handleGetAll(ctx, query);
          if (route.method === 'POST') return await handlePost(ctx);
          if (route.method === 'DELETE') return await handleDeleteAll(ctx, query);
          break;
        case 'collectionMethod':
          if (route.method === 'GET' && route.name === 'by-names') return await handleGetByNames(ctx, query);
          if (route.method === 'DELETE' && route.name === 'by-names') return await handleDeleteByNames(ctx, query);
          if (route.method === 'PUT' && route.name === 'load') return await handleLoad(ctx);
          if (route.method === 'PUT' && route.name === 'clone') return await handleCloneAll(ctx, query);
          if (route.method === 'PUT' && route.name === 'move') return await handleMoveAll(ctx, query);
          if (route.method === 'PUT' && route.name === 'clone-by-names') return await handleCloneByNames(ctx, query);
          if (route.method === 'PUT' && route.name === 'move-by-names') return await handleMoveByNames(ctx, query);
          break;
        case 'item': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'GET') return await handleItemGet(ctx, key, query);
          if (route.method === 'PUT') return await handleItemPut(ctx, key, query);
          if (route.method === 'PATCH') return await handleItemPatch(ctx, key);
          if (route.method === 'DELETE') return await handleItemDelete(ctx, key);
          break;
        }
        case 'itemMethod': {
          const key = keyFromPath(route.key, adapter);
          if (route.method === 'PUT' && route.name === 'clone') return await handleItemClone(ctx, key, query);
          if (route.method === 'PUT' && route.name === 'move') return await handleItemMove(ctx, key, query);
          break;
        }
      }
      // Route shape matched, but no handler for this method — explicit 405.
      return sendError(ctx, Object.assign(new Error('Method not allowed for this route'), {status: 405, code: 'MethodNotAllowed'}));
    } catch (err) {
      sendError(ctx, err);
    }
  };
};
