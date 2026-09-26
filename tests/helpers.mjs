export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function createFetchQueue(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (...args) => {
    calls.push(args);
    if (queue.length === 0) throw new Error('unexpected fetch');
    const next = queue.shift();
    return typeof next === 'function' ? next(...args) : next;
  };
  return { fetchImpl, calls };
}
