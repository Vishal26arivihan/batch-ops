'use strict';
// Worker side: synchronous calls to the main thread (network, cache, locks).
// The Apps Script code is synchronous, so it runs in a worker that blocks (Atomics.wait)
// while the main thread does the async work. The main thread itself never blocks.
const { workerData, receiveMessageOnPort } = require('worker_threads');

const flag = new Int32Array(workerData.sab);
const port = workerData.port;

function hostCall(op, payload) {
  Atomics.store(flag, 0, 0);
  port.postMessage({ op: op, payload: payload });
  for (;;) {
    Atomics.wait(flag, 0, 0, 60000);
    const msg = receiveMessageOnPort(port);
    if (msg) {
      const r = msg.message;
      if (!r.ok) { const e = new Error(r.error); e.hostError = true; throw e; }
      return r.value;
    }
    if (Atomics.load(flag, 0) === 1) Atomics.store(flag, 0, 0);
  }
}

module.exports = { hostCall };
