import test from 'tape-six';

import * as thunk from 'dynamodb-toolkit-koa';
import * as core from 'dynamodb-toolkit/koa';

test('thunk: re-exports the dynamodb-toolkit/koa surface verbatim', t => {
  t.deepEqual(Object.keys(thunk).sort(), Object.keys(core).sort(), 'same export surface');
  for (const key of Object.keys(core)) {
    t.equal(thunk[key], core[key], `same identity: ${key}`);
  }
});
