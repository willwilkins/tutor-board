// WebSocket connection to one board on the server, with automatic reconnect.
// onStatus receives 'online', 'offline' or 'notfound' (bad board link: no retry).
export function connect({ boardId, onMessage, onStatus }) {
  let ws;
  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?board=${encodeURIComponent(boardId)}`);
    ws.onopen = () => onStatus('online');
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (e.code === 4404) {
        onStatus('notfound');
        return;
      }
      onStatus('offline');
      setTimeout(open, 1000);
    };
  }
  open();
  return {
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}
