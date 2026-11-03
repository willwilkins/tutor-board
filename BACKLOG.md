# Backlog

## Next (in order)
- [ ] Share with a student over the internet (Cloudflare Tunnel, SPEC R29–R34):
      - "Copy student link" button (R31). Needs the tunnel address: see SPEC section 7
      - Board list and "Create board" for the tutor only; a student sees only their board (R33)
      - Stop a malformed address such as `/%` crashing the server; cap message size (R34)
      - Keep ink drawn while offline and send it on reconnect (R30)
- [ ] iPad / Surface: palm rejection, two-finger pan, pinch zoom (SPEC R27). A resting hand
      currently stops the pen drawing
- [ ] Select and move: lasso/box select, drag to move, delete selection, undoable (SPEC R20–R21)
- [ ] Smooth zoom: zoom buttons, animated button zooms, shortcuts (SPEC R15–R16)

## Toolbar and navigation (no particular order)
- [ ] Icon toolbar instead of words (with hover tooltips). Should also stop the toolbar
      wrapping and covering the page tabs in narrow windows
- [ ] Text tool: click to place a text box, type, edit later
- [ ] Quick shapes, including graph axes:
      - "+" axes: crossing at 0, with x and y spaced evenly
      - "L" axes: first-quadrant style
      - Shapes are easy to drag, anchor/centre and stretch with handles, like Figma
- [ ] Selection and pan tools in the toolbar (select ties in with "Select and move" above;
      Pan is already there as text and becomes an icon)
- [ ] Keyboard shortcuts for every tool, plus mouse modifiers for fluid navigation and
      writing, e.g. hold Alt and drag to pan, Ctrl + scroll to zoom
      (Space-drag pan and Ctrl + scroll zoom already work)

## UI/UX polish (direction not decided yet)
- [ ] Make the overall UI/UX better. Still open what this means; start by using the app
      in a real lesson and noting what feels clunky, then turn those notes into items here.
      Possible areas: visual style and spacing, toolbar layout, board list screen,
      feedback when things happen (saved, synced, undo), first-time use

## Later
- [ ] PDF / image backgrounds to write on (worksheets)
- [ ] Highlighter
- [ ] Graph paper background

## Ideas (unsorted)
- Live cursor showing where the other person is

## Done
- [x] v0.1: pressure pen, eraser, pages, endless canvas, pan/zoom, undo/redo, live sync, PNG export
- [x] v0.2: boards, one per lesson: board list, editable titles, default title `YYYY-MM-DD_Student_Subject` (SPEC R6–R9)
