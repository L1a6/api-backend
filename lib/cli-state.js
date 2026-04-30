const CLI_STATE_TTL_MS = 10 * 60 * 1000;
const cliStateStore = new Map();

function storeCliState(state, payload) {
  cliStateStore.set(state, {
    ...payload,
    createdAt: Date.now()
  });
}

function consumeCliState(state) {
  const entry = cliStateStore.get(state);
  if (!entry) {
    return null;
  }

  cliStateStore.delete(state);

  if (Date.now() - entry.createdAt > CLI_STATE_TTL_MS) {
    return null;
  }

  return entry;
}

function cleanupCliState() {
  const now = Date.now();
  for (const [key, entry] of cliStateStore.entries()) {
    if (now - entry.createdAt > CLI_STATE_TTL_MS) {
      cliStateStore.delete(key);
    }
  }
}

module.exports = {
  storeCliState,
  consumeCliState,
  cleanupCliState
};
