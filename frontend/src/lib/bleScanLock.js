let scanOwner = null;
let waiters = [];

function wakeNext() {
  if (scanOwner || waiters.length === 0) return;
  const next = waiters.shift();
  scanOwner = next.owner;
  next.resolve(() => releaseBleScan(next.owner));
}

export function acquireBleScan(owner) {
  if (!scanOwner) {
    scanOwner = owner;
    return Promise.resolve(() => releaseBleScan(owner));
  }
  return new Promise((resolve) => {
    waiters.push({ owner, resolve });
  });
}

export function releaseBleScan(owner) {
  if (scanOwner !== owner) return;
  scanOwner = null;
  wakeNext();
}
