# Tutor Board — Specification

**Status:** Draft v0.2 · **Last updated:** 2026-11-02

## 1. Purpose

Tutor Board is a free online whiteboard for one-to-one tutoring, a home-grown alternative
to tools like BitPaper. It exists because free whiteboards lag and drop pen samples, which
makes handwriting (letters, numbers, small loops) come out illegible. Its main promise:
**what you write is what appears, with no visible delay.**

## 2. Users

- **Tutor (primary):** writes with a Wacom Intuos BT S over USB on Windows.
- **Student (secondary):** joins a lesson's board from their own device and can draw, erase
  and add pages, the same as the tutor.

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

### 4.1 Pen input and drawing
- **R1.** Capture every pen sample the device sends (coalesced and raw pointer events where
  the browser supports them).
- **R2.** Line width follows pen pressure. A mouse draws at a fixed width.
- **R3.** Ink appears in the same frame as the pen sample that produced it. The app uses a
  low-latency canvas, and the browser's predicted points fill in the gap at the pen tip.
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
- **Target:** on the same network, a stroke appears for the other person within 100 ms.

### 4.8 Devices
- **R26.** Wacom on Windows in Chrome or Edge: fully supported.
- **R27.** iPad with Apple Pencil, and Surface pen: palm rejection, two-finger pan, pinch
  zoom.

### 4.9 Sharing
- **R28.** Works on the tutor's own computer, and on the same Wi-Fi via the computer's
  network address.
- **R29.** A student joins a lesson's board over the internet with a link (Cloudflare
  Tunnel).

## 5. Out of scope for now
- Voice and video (use Zoom or Meet alongside).
- User accounts and logins.
- Partial (cut-through) eraser.
- PDF export.
- Native or mobile apps (browser only).

## 6. Current status

v0.2 is done: R1–R14, R17–R19, R22–R26 and R28 are built, including boards (one per
lesson, with a board list and editable titles). Still to do: smooth and animated zoom with
buttons (R15–R16), select and move (R20–R21), tablet support (R27) and sharing (R29).
See BACKLOG.md.

## 7. Open questions
1. **Security once shared online:** should a board link need a secret token or password so
   strangers can't get in? (Proposed: a secret token in each board's link.)
2. **Student access to the board list:** can a student see only the board they were sent,
   or all their own past boards? (Proposed: only the board they were sent.)
