// WebSocket connection to one board, with automatic reconnect.
//
// Nothing sent is lost when the connection drops (SPEC R30). Every message is
// numbered and kept in an outbox until the server confirms it has saved it
// (an 'ack'). After reconnecting, the server's 'init' says what it has saved;
// the app gets that board first (and can put unsaved changes back on screen
// using pending()), then everything still in the outbox is sent again.
//
// send() never waits: it queues and returns, online or not.
// onStatus receives 'online', 'offline' or 'notfound' (bad board link: no retry).

// If the server confirms nothing for this long, the connection is probably
// dead without the browser noticing (e.g. the network changed), so start over.
const STALE_MS = 15_000;

export function connect({ boardId, clientId, onMessage, onStatus }) {
  let ws = null;
  let ready = false; // true once this connection's init has arrived
  let seq = 0;
  let lastAck = 0;
  const outbox = []; // { seq, msg, data, sentAt }

  function open() {
    ready = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(
      `${proto}://${location.host}/ws?board=${encodeURIComponent(boardId)}&client=${clientId}`,
    );
    ws = sock;
    sock.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'ack') {
        confirmed(m.seq);
      } else if (m.type === 'init') {
        confirmed(m.ack);
        onMessage(m);
        ready = true;
        for (const o of outbox) transmit(o);
        onStatus('online');
      } else {
        onMessage(m);
      }
    };
    sock.onclose = (e) => {
      ready = false;
      if (e.code === 4404) {
        onStatus('notfound');
        return;
      }
      onStatus('offline');
      setTimeout(open, 1000);
    };
  }

  // Drops a connection that has stopped answering and opens a new one.
  function restart() {
    const old = ws;
    old.onclose = old.onmessage = null;
    try {
      old.close();
    } catch { /* already closed */ }
    onStatus('offline');
    open();
  }

  function confirmed(n) {
    lastAck = performance.now();
    let i = 0;
    while (i < outbox.length && outbox[i].seq <= n) i++;
    if (i) outbox.splice(0, i);
  }

  function transmit(o) {
    o.sentAt = performance.now();
    ws.send(o.data);
  }

  setInterval(() => {
    if (!ready || !outbox.length || ws.bufferedAmount > 0) return;
    if (performance.now() - Math.max(outbox[0].sentAt, lastAck) > STALE_MS) restart();
  }, 2000);

  open();

  return {
    send(msg) {
      const o = { seq: ++seq, msg, data: JSON.stringify({ ...msg, seq }), sentAt: 0 };
      outbox.push(o);
      if (ready && ws.readyState === WebSocket.OPEN) transmit(o);
    },
    // Messages the server hasn't confirmed yet, oldest first.
    pending: () => outbox.map((o) => o.msg),
    get unsent() {
      return outbox.length;
    },
  };
}
