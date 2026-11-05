# Backlog

Students are most likely to join from a laptop or an iPad, not a phone. Phone-only
problems are low priority and only worth fixing when the fix is quick.

## Bugs
(none open)

## Next (in order)
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
      stylus couldn't write. Found on an iPhone, 2026-11-04; fixed 2026-11-05
- [x] iPad / Surface (SPEC R27, R35, 2026-11-05). Tested with simulated touch and pen
      input; still to try on a real iPad. Rules:
      - Two fingers always pan and pinch zoom; a third finger is ignored
      - No pen used yet on this device: one finger uses the current tool. If a second
        finger lands mid-stroke, the stroke is cancelled (it was a pinch, not writing)
      - Once a pen has been used (remembered on the device): one finger does nothing
        (it's probably a palm), unless the Pan tool is selected
      - The pen always wins: it cancels any finger gesture in progress, and fingers are
        ignored while the pen is down
      - After a pinch, or with fingers down while the pen was down, nothing new starts
        until all fingers are up
