# Tutor Board

A low-latency whiteboard for online tutoring. Built so handwriting stays legible:
every pen sample is captured, drawn immediately, and sent in full to everyone else.

## Run it

```
npm install
npm start
```

Open http://localhost:3000 to see your boards. Create one per lesson: enter the student
and subject and it's titled `YYYY-MM-DD_Student_Subject` (you can change the title, and
rename it later by clicking it at the top-left of the board).

Each board has its own link (`/b/<id>`). Open the same link in a second window to see
live sync. Boards are saved to `data/boards/` (not committed to git).

## Share a board with a student

**Over the internet.** Install cloudflared once (free, no Cloudflare account needed). It's a
single program file. Either:

- install it with winget (it goes on the C: drive):
  ```
  winget install --id Cloudflare.cloudflared
  ```
- or put it in a folder of your choice, e.g. `D:\Programs\cloudflared`: download
  `cloudflared-windows-amd64.exe` from
  [Cloudflare's releases](https://github.com/cloudflare/cloudflared/releases/latest), save it
  there as `cloudflared.exe`, and add that folder to your PATH (or set `CLOUDFLARED` to the
  file's full path).

Then close the terminal and open a new one, so it sees the newly installed program, and run
`npm start` there. It also starts a Cloudflare tunnel; the terminal shows
`Sharing: student links use https://<name>.trycloudflare.com`. Open the lesson's board and
click **Copy student link** (top right), then send the link to your student. It opens in any
browser, and they can draw, erase and add pages with you.

- The link is the key: anyone with it can open that board, and nothing else. Students
  never see your board list or other boards.
- The tunnel gets a new address every time the app starts, so after a restart, copy and
  send a fresh link. The new address takes about 20–30 seconds to start working. If you
  open it sooner, your network may remember it as "not found" for a few minutes.
- If the button says **Sharing is off**, hover over it to see why (usually cloudflared
  isn't installed). The app works as normal either way. cloudflared's output is in
  `data/cloudflared.log`. Set `TUNNEL=off` to start without the tunnel.
- If the tunnel won't start and you've used cloudflared before, a `config.yml` in
  `%USERPROFILE%\.cloudflared` can get in the way of quick tunnels; rename it.

**On the same Wi-Fi.** The student can also open `http://<your computer's address>:3000/b/<id>`.
They get the same student view.

**Who counts as the tutor.** Only a browser on the computer running the app, using an
address like `localhost`, sees the board list. Everyone else, including anyone coming
through the tunnel, is a student. The tunnel goes to a second port (3001) that only serves
board pages and is not reachable from other devices.

**If the connection drops** (yours or the student's), keep writing: your ink stays on screen
and is sent when the app reconnects, which it does by itself.

## Why it doesn't scribble like other whiteboards

- **Full-rate input.** Browsers normally deliver one pointer event per frame and drop the
  pen samples in between. We read them all back with `getCoalescedEvents()` and use
  `pointerrawupdate` where supported, so small loops in letters and digits survive.
- **Ink appears locally first.** Your strokes are drawn the moment the pen moves, never
  after a round trip to the server.
- **Low-latency canvas.** The ink canvas uses `desynchronized: true`, and a top overlay
  draws the browser's predicted next points to hide the last few milliseconds of lag.
- **No point thinning.** Every sample is sent, just grouped once per frame. Strokes are
  drawn as smooth curves through the midpoints of the samples.

The status bar shows `pen ___ Hz` after each stroke: how many samples per second were
captured. A Wacom pen usually gives 130–240 Hz; a mouse gives about 60–1000 Hz depending on the mouse.

## Controls

| Action | How |
| --- | --- |
| Pen / Eraser / Pan | `P` / `E` / `H`, or the toolbar |
| Erase with the pen | Flip the Wacom pen and use the eraser end |
| Pan | Hold `Space` and drag, middle-drag, the pen's side button, or the scroll wheel |
| Zoom | `Ctrl` + scroll, or pinch on a trackpad. Click the % to reset |
| Fit everything on screen | `F` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Pages | `+ Page`, click to switch, double-click to rename |
| Export | Downloads the current page as a PNG, cropped to your writing plus padding |

## Wacom tips (Windows)

- In the Wacom Tablet Properties app, keep **Use Windows Ink** turned on for your pen,
  otherwise browsers get no pressure.
- Chrome or Edge give the best results (they support raw pointer updates and prediction).

## Roadmap

See [BACKLOG.md](BACKLOG.md).
