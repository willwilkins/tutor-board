# Backlog

Students are most likely to join from a laptop or an iPad, not a phone. Phone-only
problems are low priority and only worth fixing when the fix is quick.

## Bugs
Found in the first test on a real iPad, 2026-11-05 (`ipad` branch):
- [ ] Apple Pencil ink lands about 0.5–1 cm below the Pencil tip. A finger probably has
      the same offset, hidden under the fingertip. Likely cause: the canvases are sized
      with CSS `100vw`/`100vh` (style.css), and in iPad Safari `100vh` can be taller than
      the visible window, which stretches the drawing downwards. Fix built 2026-11-06:
      the canvases are now sized from `innerWidth`/`innerHeight` in `resize()` (app.js).
      To confirm on the iPad with the debug mode
- [ ] The Pencil didn't draw while a palm was on the screen, which is exactly what SPEC
      R27 promises. Maybe the palm was touching outside the browser window. One guess to
      check: Safari may report the Pencil as a finger while another touch is down, which
      would make palm + Pencil a two-finger pinch. Needs the debug mode
- [ ] Shifting the palm panned the page by accident. Probably the hand touching in two
      places, which counts as a two-finger pinch. Possible safeguards: ignore new touches
      for about 1 s after the Pencil lifts; ignore large contacts, if the iPad reports
      contact size
- [ ] The student link says "This board link doesn't work", even when opened fresh in a
      new tab, although Copy student link gives the same link and the board opens on the
      computer. Every board file on disk reads fine and the server logs nothing, so the
      cause is unknown. Fix: log the requested ID and the reason for every refused board;
      only call a board missing when its file really doesn't exist (retry a read error);
      show the ID in the notice. On the iPad, compare the address Safari opens with the
      copied link

Found in the second iPad test, 2026-11-06 (details and how to check in TEST-LOG.md):
- [ ] All input (finger and Pencil) suddenly landed about 50 mm left of and 15 mm below
      the finger, after touching the toolbar. Only inside the Safari window (not full
      screen): the Pencil was accurate over other apps. Leaving Safari and coming back
      fixed it, and it's said to happen in other iPad apps too. Most likely Safari's
      window moved or resized and Safari kept the old position for touches. Could also
      be the page zooming or scrolling, since only the canvas blocks that. Try to
      reproduce by moving or resizing the Safari window with the debug mode on
- [ ] The dot of an exclamation mark is often missed when written lightly. Likely cause:
      a dot keeps the pressure from the moment the pen touched down (near zero for a
      quick light tap), and later samples at the same spot are skipped along with their
      higher pressure, so the dot is about 1 px across. Fix idea: keep the highest
      pressure seen for a point that doesn't move, and give dots a minimum size

## Next (in order)
- [ ] iPad / Surface (SPEC R27, R35). Built and tested with simulated touch and pen input
      on 2026-11-05; the first real-iPad test found the bugs above. Order: debug mode,
      then the offset fix, then the palm problems, then the hint. Done only after it
      passes a real-iPad test with and without a Pencil. Rules:
      - Two fingers always pan and pinch zoom; a third finger is ignored
      - No pen used yet on this device: one finger uses the current tool. If a second
        finger lands mid-stroke, the stroke is cancelled (it was a pinch, not writing)
      - Once a pen has been used (remembered on the device): one finger does nothing
        (it's probably a palm), unless the Pan tool is selected
      - The pen always wins: it cancels any finger gesture in progress, and fingers are
        ignored while the pen is down
      - After a pinch, or with fingers down while the pen was down, nothing new starts
        until all fingers are up

      - [x] Touch debug mode (`?debug` on a board link), built 2026-11-06: a ring and
        cross where the browser reports each pointer, sized like the contact; each
        pointer's type, id, contact size and pressure; the last down/up/cancel events
        with what the app did; the window, canvas, `100vh` and `visualViewport` sizes

      Still to build:
      - Hint when one finger drags in pen mode: "Use two fingers to move the page (or
        pick Pan)". Shown rarely, and only for a small contact that moves far, so a
        drifting palm doesn't trigger it
- [ ] Icon toolbar instead of words (with hover tooltips), including Select and Pan tools.
      On an iPad in portrait the toolbar wraps into 3 rows across the top of the screen,
      and on a desktop it wraps in any window narrower than about 1760 px. Two causes: its
      full width is 880 px, and `left: 50%` limits it to half the screen. Use icons
      wherever possible (toolbar, page bar, status bar). Do this before adding more tools
- [ ] Stop a student wiping the tutor's work. Delete page can't be undone and the server
      lets anyone do it. Clear can only be undone in the tab that pressed it, so the tutor
      can't undo a student's Clear. See SPEC open question 1
- [ ] Use it in a real lesson with a student on an iPad, then turn what feels clunky into
      items here (see UI/UX polish)
- [ ] Select and move: lasso/box select, drag to move, delete selection, undoable (SPEC R20–R21)
- [ ] Paste an image (e.g. a screenshot of an exam question) onto a page to write on.
      Images need their own upload path, because live messages are capped at 2 MB
- [ ] Smooth zoom and shortcuts: zoom buttons, animated button zooms (SPEC R15–R16),
      keyboard shortcuts for every tool, mouse modifiers such as Alt-drag to pan
      (Space-drag pan and Ctrl + scroll zoom already work)

## After that (rough order)
- [ ] Quick shapes, including graph axes:
      - "+" axes: crossing at 0, with x and y spaced evenly
      - "L" axes: first-quadrant style
      - Shapes are easy to drag, anchor/centre and stretch with handles, like Figma
- [ ] Text tool: click to place a text box, type, edit later
- [ ] Deleting with a small ✕ in a circle at the top-left corner (e.g. of a page tab),
      which opens a confirmation popup before anything is deleted (in place of the
      browser's own confirm box)

## UI/UX polish (direction not decided yet)
- [ ] Make the overall UI/UX better. Still open what this means; start by using the app
      in a real lesson and noting what feels clunky, then turn those notes into items here.
      Possible areas: visual style and spacing, toolbar layout, board list screen,
      feedback when things happen (saved, synced, undo), first-time use

## Later
- [ ] Phone layout: the toolbar and colour palette take up too much of a phone screen
      (the toolbar wraps into 5 rows). Use icons and show fewer options at a time (e.g. tap
      the current colour to open the palette). Phones are unlikely in lessons
- [ ] PDF backgrounds to write on (worksheets)
- [ ] Highlighter
- [ ] Graph paper background

## Ideas (unsorted)
- Live cursor showing where the other person is

## Done
- [x] v0.1: pressure pen, eraser, pages, endless canvas, pan/zoom, undo/redo, live sync, PNG export
- [x] v0.2: boards, one per lesson: board list, editable titles, default title `YYYY-MM-DD_Student_Subject` (SPEC R6–R9)
- [x] v0.3: share with a student over the internet (Cloudflare Tunnel, SPEC R29–R34): "Copy student
      link" button, board list for the tutor only, malformed requests and oversized messages no
      longer crash the server, ink drawn while offline is kept and sent on reconnect
- [x] Phone: the page tabs were hidden (the page bar shrank to 35 px and showed as a blank
      white box). On narrow screens it now sits above the status bar (2026-11-05)
- [x] Bug: on a touch screen with no stylus, a finger could only pan, so a student with no
      stylus couldn't write. Found on an iPhone, 2026-11-04; fixed 2026-11-05, and finger
      drawing worked on a real iPad
