# Backlog

## Bugs (found testing a student link on an iPhone, 2026-11-04)
- [ ] On a phone, a finger can only pan: Pen and Eraser do nothing even when selected.
      Touch input is always treated as panning (made for palm rejection), so a student
      with no stylus can't write. Ties in with the iPad / Surface item below (SPEC R27)
- [ ] The page-tab bar's white button doesn't match "+ Page" and "Delete page" (it shows as
      a blank white box next to them)

## Next (in order)
- [ ] iPad / Surface: palm rejection, two-finger pan, pinch zoom (SPEC R27). A resting hand
      currently stops the pen drawing
- [ ] Select and move: lasso/box select, drag to move, delete selection, undoable (SPEC R20–R21)
- [ ] Smooth zoom: zoom buttons, animated button zooms, shortcuts (SPEC R15–R16)

## Toolbar and navigation (no particular order)
- [ ] Icon toolbar instead of words (with hover tooltips). Should also stop the toolbar
      wrapping and covering the page tabs in narrow windows. Use icons instead of text
      wherever possible (toolbar, page bar, status bar)
- [ ] Phone layout: the toolbar and colour palette take up too much of a phone screen.
      Use icons and show fewer options at a time (e.g. tap the current colour to open the
      palette)
- [ ] Deleting with a small ✕ in a circle at the top-left corner (e.g. of a page tab),
      which opens a confirmation popup before anything is deleted (in place of the
      browser's own confirm box)
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
- [x] v0.3: share with a student over the internet (Cloudflare Tunnel, SPEC R29–R34): "Copy student
      link" button, board list for the tutor only, malformed requests and oversized messages no
      longer crash the server, ink drawn while offline is kept and sent on reconnect
