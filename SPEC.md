# Tutor Board — Specification

**Status:** Draft v0.3 · **Last updated:** 2026-11-05

## 1. Purpose

Tutor Board is a free online whiteboard for one-to-one tutoring, a home-grown alternative
to tools like BitPaper. It exists because free whiteboards lag and drop pen samples, which
makes handwriting (letters, numbers, small loops) come out illegible. Its main promise:
**what you write is what appears, with no visible delay.**

## 2. Users

- **Tutor (primary):** writes with a Wacom Intuos BT S over USB on Windows.
- **Student (secondary):** joins a lesson's board from their own device, using a link from
  the tutor, and can draw, erase and add pages, the same as the tutor. They see only that
  board. Students most likely use a laptop or an iPad (possibly without a stylus); a
  phone is unlikely.

## 3. Principles

1. **Never give up pen accuracy.** Every pen sample is captured, drawn and sent. No thinning
   points, no throttling, no smoothing that changes shapes.
2. **Your own ink never waits.** It's drawn the moment the pen moves, never after a round
   trip to the server.
3. **Moving around is as smooth as writing.** Panning and zooming happen constantly in a
   lesson, so they must feel instant and fluid.
4. **Keep it lean.** Few dependencies, plain web technology.
5. **Free to run.** It runs on the tutor's own computer for now; any later hosting must have
   a free option.

## 4. Requirements

Requirement numbers are fixed IDs. A new requirement takes the next free number, so some
numbers appear out of order.

### 4.1 Pen input and drawing
- **R1.** Capture every pen sample the device sends (coalesced and raw pointer events where
  the browser supports them).
- **R2.** Line width follows pen pressure. A mouse draws at a fixed width.
- **R3.** Ink appears in the same frame as the pen sample that produced it. The app uses a
  low-latency canvas, and the browser's predicted points fill in the gap at the pen tip.
  Not on Android or Chromebooks, where the low-latency canvas broke the display (see the
  2026-11-06 decision below).
- **R4.** Strokes are smooth curves through the actual samples and keep small direction
  changes and loops.
- **R5.** The status bar shows the last stroke's sample rate ("pen ___ Hz").
- **Target:** Wacom on USB gives about 130 Hz with no drops. Bluetooth (about 70 Hz with
  roughly 0.5 s lag) is a known issue; use USB for tutoring.

### 4.2 Boards (one per lesson)
- **R6.** Each lesson gets its own board. A board contains pages.
- **R7.** Boards have editable titles, renamed in place like a Google Docs file title.
- **R8.** New boards get a default title of `YYYY-MM-DD_StudentName_Subject`, for example
  `2026-11-02_Alex_Maths`. Today's date is filled in automatically; the tutor gives the
  student name and subject when creating the board.
- **R9.** A board list shows all boards (newest first), for opening past lessons or making a
  new one.

### 4.3 Pages and canvas
- **R10.** Every page is an endless canvas.
- **R11.** A board has many pages, which can be added, renamed, switched and deleted.
- **R12.** Each page remembers its own pan and zoom position during a session.
- **R13.** The background has a light dot grid that moves with the canvas.

### 4.4 Navigation (pan and zoom)
- **R14.** Pan with a dedicated Pan tool, and also without switching tools: hold Space and
  drag, middle-drag, the pen's side button, or the scroll wheel.
- **R15.** Zoom smoothly and continuously around the cursor with Ctrl+scroll or a trackpad
  pinch; on tablets, pinch with two fingers (see R27).
- **R16.** Zoom in, zoom out and reset buttons are on screen, with shortcuts. Button zooms
  animate rather than jumping.
- **R17.** **Fit** zooms to show everything on the page.
- **Target:** pan and zoom stay at the display's full frame rate on a page with hundreds of
  strokes.

### 4.5 Tools
- **R18.** Pen with 6 colours and 4 sizes.
- **R19.** The eraser removes whole strokes only. It works from the toolbar, the `E` key, or
  the Wacom pen's eraser end.
- **R20.** **Select and move:** draw a lasso (or drag a box) around strokes to select them,
  then drag to move them. Selected strokes can also be deleted. Moves sync live and can be
  undone.
- **R21.** Undo and redo cover drawing, erasing, clearing a page and moving.

### 4.6 Export
- **R22.** Export saves the current page as a PNG, cropped to everything on the page plus
  padding, with a white background. (PNG is enough; PDF isn't needed.)

### 4.7 Sync and saving
- **R23.** Everyone on the same board sees strokes live, while they're being drawn.
- **R24.** Boards are saved automatically on the server and survive restarts and refreshes.
- **R25.** If the connection drops, the app reconnects on its own and reloads the board.
- **R30.** Ink drawn while the connection is down stays on screen and is sent once the app
  reconnects, so nothing written is lost.
- **Target:** on the same network, a stroke appears for the other person within 100 ms.

### 4.8 Devices
- **R26.** Wacom on Windows in Chrome or Edge: fully supported.
- **R27.** iPad with Apple Pencil, and Surface pen: palm rejection (a hand resting on the
  screen never blocks the pen or moves the page), two-finger pan, pinch zoom.
- **R35.** On a touch screen with no stylus (such as an iPad without a Pencil), one finger
  uses the current tool (draws, erases), and two fingers pan and pinch zoom.

### 4.9 Sharing and access
- **R28.** Works on the tutor's own computer, and on the same Wi-Fi via the computer's
  network address.
- **R29.** A student joins a lesson's board over the internet with a link (Cloudflare
  Tunnel). Free quick tunnels need no Cloudflare account. Each time the tunnel starts it
  gets a new address, so after a restart the student needs a new link.
- **R31.** A **Copy student link** button on the board copies the link for a student to
  open over the internet.
- **R32.** The link is the key: a student needs nothing else to join, and there is no
  password. Board IDs are random and too long to guess (72 bits), and must stay that way.
- **R33.** Only the tutor sees the board list and can create boards, without logins (see
  section 5). A student sees only the board they were sent, with no way through to the
  list or to other boards.
  - **Note:** tunnel traffic reaches the server from the tutor's own computer, so a check
    for "is this request local?" can't tell the tutor from a student.
- **R34.** A malformed request or an oversized message is refused without stopping the
  server, so one bad request can never end a lesson.

## 5. Out of scope for now
- Voice and video (use Zoom or Meet alongside).
- User accounts and logins.
- Partial (cut-through) eraser.
- PDF export.
- Native or mobile apps (browser only).

## 6. Current status

v0.3 is done: R1–R14, R17–R19 and R22–R26, plus sharing over the internet (R28–R34).
A student can join a board from anywhere with a link, sees only that board, and ink
drawn while offline is kept and sent on reconnect.

Touch screens (R27, R35) were built on 2026-11-05 on the `ipad` branch: a finger draws
and erases when no pen has been used on the device, two fingers pan and pinch zoom, and
once a pen has been used a resting hand should be ignored (see Decisions). They passed
tests with simulated touch and pen input in Chrome. The first test on a real iPad, the
same day, found that the layout is good and finger drawing works, but also found these
problems (details in BACKLOG.md):
- Apple Pencil ink lands about 0.5–1 cm below the tip.
- The Pencil didn't draw while a palm was on the screen (R27).
- Shifting the palm panned the page by accident (R27).
- The student link said "This board link doesn't work", even opened fresh, although the
  board opens fine on the computer.

Problems found in testing on 2026-11-03, and where they stand:
- Fixed in v0.3: anyone who could reach the server could list every board (R33).
- Fixed in v0.3: a malformed address such as `/%` crashed the server, and so did a
  malformed WebSocket frame (R34).
- Fixed in v0.3: ink drawn while the connection was down disappeared on reconnect and was
  never saved (R30).
- Open: on a touch screen, a hand resting on the screen stops the pen drawing until it's
  lifted (R27). A fix was built on 2026-11-05, but a real iPad still showed it.

Tested on 2026-11-04 with a real Cloudflare tunnel, including a student link opened on an
iPhone: the board loaded and synced live. That test also found that a finger could only
pan on a touch screen (no pen or eraser, R35; fixed on 2026-11-05), and that the toolbar
is too big for a phone screen (see BACKLOG.md). The page tabs were also hidden on a phone;
fixed on 2026-11-05.

Still to do, in this order (see BACKLOG.md):
1. **iPad support (R27, R35).** Fix what the real-iPad test found, starting with a touch
   debug mode, then pass a real-iPad test with and without a Pencil.
2. **Icon toolbar.** On an iPad the toolbar wraps into 3 rows; icons also leave room for
   new tools.
3. **A student can't wipe the tutor's work** (open question 1).
4. **Use it in a real lesson**, then re-sort the backlog from what that shows.
5. **Select and move (R20–R21).**
6. **Paste an image onto a page** (worksheets, exam questions).
7. **Smooth and animated zoom with buttons (R15–R16), and shortcuts.** Ctrl+scroll and
   trackpad pinch already work, so this is the least urgent.

## 7. Open questions
1. **Deleting a page and clearing a page.** Today anyone can delete a page, which can't be
   undone, and a Clear can only be undone in the tab that pressed it. Should deleting
   pages be tutor-only, or open to students but undoable by the tutor? Should Clear ask
   first?

## 8. Decisions
- **2026-11-03 · Access to a board:** the board's link is the only key, with no password.
  The random board ID already works as the secret token (R32). Was open question 1.
- **2026-11-03 · What a student sees:** only the board they were sent, not their past
  boards or the board list (R33). Was open question 2.
- **2026-11-03 · Where the student link comes from:** `npm start` runs
  `cloudflared tunnel --url http://127.0.0.1:<student port>` when cloudflared is installed,
  reads the `https://<name>.trycloudflare.com` address from its log output, and the
  **Copy student link** button uses it (R31). If cloudflared is missing or fails, the app
  starts as normal and the button says sharing is off. The tunnel stops with the app.
- **2026-11-03 · Telling the tutor from a student:** the tunnel points at a second port
  (main port + 1, so 3001) that listens on this computer only and serves just the board
  page, its files and the live connection. On the main port, only requests from this
  computer (loopback or its own network address), using `localhost`, an IP address or the
  computer's name, count as the tutor; everyone else, including same-Wi-Fi students,
  is a student (R33). The name check stops other websites reaching the board list
  through the tutor's browser.
- **2026-11-03 · No ink lost offline:** each browser tab numbers its messages and keeps
  them until the server confirms they're saved to disk, then resends the rest after
  reconnecting. Resends are safe to repeat (R30). A tab that hears nothing back for 15 s
  reconnects, so a connection that dies silently is noticed.
- **2026-11-03 · Message size cap:** 2 MB per WebSocket message (was the library default
  of 100 MB). A minute of non-stop writing is about 350 KB, and the app splits strokes
  over 10,000 samples into several messages (R34).
- **2026-11-05 · Phones:** students are unlikely to join a lesson from a phone, so
  phone-only problems are low priority and are fixed only when the fix is quick. The iPad
  is the student tablet that matters (R27, R35).
- **2026-11-05 · Fingers and the pen (R27, R35):** two fingers always pan and pinch zoom.
  One finger uses the current tool until a pen (including Apple Pencil hover) is first
  used on the device; the browser then remembers it, and from then on one finger does
  nothing (it's probably a palm) unless the Pan tool is selected. The pen always wins: it
  cancels a finger gesture and fingers are ignored while it's down. A finger stroke that
  turns into a pinch, is interrupted by the pen, or is cancelled by iOS is deleted for
  everyone and left out of undo. A cancelled pen stroke is kept. Once a pen has been
  used, one finger dragging shows a hint ("use two fingers to move the page") rather than
  panning, to keep palm rejection safe.
- **2026-11-06 · No low-latency canvas on Android or Chromebooks (R3):** on a Google
  Pixel in Brave, the board turned black at the first touch and showed no ink
  (TEST-LOG.md). There, Chromium can send a low-latency canvas straight to the screen,
  which breaks a see-through canvas with page elements on top. A normal canvas costs
  about one frame of delay on those devices. Windows, Mac and iPad are unchanged.
  `?lowlatency=on` or `=off` on a board link overrides this, for testing.
