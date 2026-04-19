// Stream-based JSON body reader with a byte-size cap. Used when the Koa
// consumer hasn't wired a body parser (no `ctx.request.body`) — we read the
// raw Node request ourselves instead of requiring an extra dependency.
//
// Mirrors the node:http handler's `readJsonBody` so adapter wire behavior
// (413 on overflow, 400 on invalid JSON) stays identical.

export const readJsonBody = (req, maxBodyBytes) =>
  new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let aborted = false;
    req.setEncoding?.('utf8');
    req.on('data', chunk => {
      if (aborted) return;
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      size += s.length;
      if (size > maxBodyBytes) {
        aborted = true;
        // Don't `req.destroy()` here: Koa needs the socket alive to write the
        // 413 response via ctx. Backpressure via `aborted` + GC handles the
        // dangling bytes; a malicious over-send pays only the kernel-buffer
        // cost until Koa finishes the error response.
        reject(Object.assign(new Error(`Request body exceeds ${maxBodyBytes} bytes`), {status: 413, code: 'PayloadTooLarge'}));
        return;
      }
      body += s;
    });
    req.on('end', () => {
      if (aborted) return;
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(Object.assign(err, {status: 400, code: 'BadJsonBody'}));
      }
    });
    req.on('error', reject);
  });
