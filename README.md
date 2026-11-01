# Tutor Board

A low-latency whiteboard for online tutoring. Built so handwriting stays legible:
every pen sample is captured, drawn immediately, and sent in full to everyone else.

## Run it

```
npm install
npm start
```

Open http://localhost:3000. Open a second window on the same address to see live sync.
The board is saved to `data/board.json` (not committed to git).

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

- Share with a student over the internet (Cloudflare Tunnel)
- iPad / Surface touch handling: palm rejection, two-finger pan and pinch zoom
- PDF / image backgrounds to write on, and export of all pages to PDF
- Live cursors, highlighter, shapes and graph paper
