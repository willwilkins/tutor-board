# Test log

Hands-on tests on real devices: what was tried, what went wrong, what we think the
cause is, and how to check it next time. Bugs to fix also go in BACKLOG.md.

## 2026-11-07 · Laptop with Wacom, and iPad (branch `claude/gifted-moore-d1b94f`)

Setup: the branch with the light-dot fix, the one-finger hint and the board-link
logging. Wacom on the tutor's laptop; iPad Safari over the student link, with `?debug`
on.

Overall: the iPad works fine now.

### 1. Wacom ink looks a little thicker

The ink seemed a little thicker than before (not certain). The tutor likes it as it is,
so nothing to change. Likely from the light-dot fix: a pen held still now keeps the
highest pressure it reached, so stroke starts can come out a little heavier, and dots
are never smaller than the pen's normal width.

### 2. Light dots of "!" still don't show on the iPad

A light press still gives no dot; pressing a little harder works. Not a priority:
users would work this out quickly. Kept in BACKLOG as low priority.

What it tells us: with the fix, any dot that reaches the app is drawn at least the pen's
normal width (3 px at the default size), so a missing dot now most likely means the
light tap never reached the page as a pen touch. iPadOS may treat a very light Pencil
tap as hover only, or the tap may arrive while the previous stroke is still ending.
No quick fix without knowing which.

How to tell next time (with `?debug` on): write "!" lightly and check the event list for
a `down pen` line for the dot. No line means the tap never reached the page, and there's
probably nothing the app can do. A line with a tiny pressure means the app's bug.

### 3. The one-finger hint never showed on the iPad

With a pen used on the iPad, dragging one finger on the canvas showed no hint. The debug
panel is see-through, so it wouldn't hide the hint.

Likely cause: the hint is skipped for contacts over 30 px (meant to rule out palms), and
Safari probably reports a fingertip as bigger than that, so every finger counts as a
palm.

How to tell next time (with `?debug` on): drag one finger and read its `size WxH` in the
debug panel (the blue ring is drawn at that size). Over 30 means this cause.

Possible fixes (not built yet): raise the size limit above a normal finger (for example
the finger's reported size plus a margin, if a palm reports clearly bigger), or drop the
size check and rely on the distance alone.

### 4. Board links with typos

- A typo in the board ID (last character changed): "This board link doesn't work. Ask
  your tutor for a new one." with the board ID shown underneath. Works as intended.
- A typo in the first half of the link, the `….trycloudflare.com` address (a word left
  out): Safari said it can't open the page because the server can't be found. Expected:
  that address names the tunnel itself, so a wrong one never reaches Tutor Board, and
  the app can't show anything. Only a correct link helps.

## 2026-11-06 · Android phone (Google Pixel, Brave) and Mac (Brave) (`ipad` branch)

Setup: a friend on a video call opened the student link over the Cloudflare tunnel in
Brave, first on a Mac laptop, then on a Google Pixel phone (Android), finger only. Debug
mode (`?debug`) was not on. The phone's 30 s screen recording is
`WhatsApp Video 2026-11-06 at 16.13.58.mp4` (tutor's Downloads folder).

Mac: worked well, responsive, no problems.

Phone: the toolbar wraps into 5 rows (already in BACKLOG, "Phone layout"), and the
problem below.

### 1. On the Android phone the board turns black at the first touch

What happened (from the screen recording):
- 0:03–0:04: the board loaded normally: white, with the dot grid.
- 0:05: the first finger touch on the board turned the whole drawing area black within
  0.1 s, grid included. The toolbar, page bar and status bar stayed normal.
- After that, nothing drawn showed on the phone, in any colour, for the rest of the
  recording (about 25 s).
- But the strokes reached the tutor's screen, the status bar showed "pen 234 Hz", and
  Clear worked (its "Page cleared" message appeared).

What it tells us:
- Touch input, stroke handling and syncing all worked. Only what the phone showed was
  wrong.
- Brave on the Mac uses the same browser engine (Chromium) and was fine, so it's how
  Chromium on Android shows the canvas, not the app's logic.
- It went black exactly when the app first drew in response to a touch.

Likely cause: the low-latency ("desynchronized") canvases.
- Both canvases ask the browser for low-latency drawing (`desynchronized: true` in
  app.js). On Android and Chromebooks, Chromium can send such a canvas straight to the
  display instead of blending it with the rest of the page. On a Mac it doesn't, which
  fits the Mac being fine.
- Chrome's docs say a see-through low-latency canvas "must not have any other DOM
  elements above it". The overlay canvas is see-through, has the toolbar and bars on
  top, and is first drawn on at the first touch.
- The ink canvas is opaque (`alpha: false`), and an opaque canvas showing nothing is
  black, so it may be involved too.

Other possibilities (less likely):
- The canvas's graphics memory was lost. Android can do this, but usually after
  switching apps, not on the first touch.
- Brave Shields: they change what a page can read back from a canvas, not what's shown.
- Brave's dark mode for pages: it would have darkened the toolbar too.

How to tell next time:
- With the fix below, the plain link should stay white and show ink. Adding
  `?lowlatency=on` to the link turns low latency back on, so the black screen should
  come back. If the plain link still goes black, the cause is something else.
- Also try Chrome on the same phone, and note the Pixel model and Android version.

Possible fixes:
- Don't ask for low-latency canvases on Android and Chromebooks. It costs about one
  frame of delay there; the tutor's Windows PC keeps low latency.
- Redraw the board if the browser drops the canvas and gives it back (the
  `contextrestored` event).

## 2026-11-06 · iPad, finger and Apple Pencil (`ipad` branch, second iPad test)

Setup: student link over the Cloudflare tunnel, iPad Safari. Included the canvas sizing
fix (canvas sized from the window, not CSS `100vh`). Debug mode (`?debug`) was **not**
on, so there are no numbers for either problem. Neither could be reproduced on purpose.

Overall: works well; the Pencil felt smooth. The earlier 0.5–1 cm offset below the
Pencil wasn't reported this time (to confirm).

### 1. All input suddenly lands about 50 mm left and 15 mm below the finger

What happened:
- While using fingers, a touch on the toolbar was followed by a touch on the canvas
  that drew nothing.
- Then ink started appearing about 50 mm left of the finger and 15 mm below it.
- The same offset stayed for the Apple Pencil.
- Fixed by leaving Safari and opening it again (the page was not reloaded).
- Someone who uses an iPad a lot says the same thing often happens in other apps,
  especially Excel.
- Safari was in a window, not full screen. While the offset was there, hovering the
  Pencil over other apps outside the Safari window was accurate.

What it tells us:
- Finger and Pencil were shifted by the same amount, so the coordinates themselves were
  wrong, not the pen handling.
- Only the Safari window was affected, not the whole iPad. So it's Safari's window or
  this page, not the screen or the Pencil.
- Leaving Safari and coming back fixed it without reloading the page, and other apps
  show it too. That leans towards Safari's window, not this app's code.

Possible causes:
1. **Safari's window moved or changed size, and Safari kept using the old position for
   touches.** With Safari not full screen, a window can be dragged or resized from its
   top edge, and the board's toolbar sits right under it. A touch there could have
   nudged the window, and a 50 mm shift is about the size of such a move. The `···`
   button at the top of the window is also right there. This fits everything seen: one
   app only, a fixed shift, and fixed by leaving the app and coming back.
2. **The page itself got zoomed or scrolled.** iOS ignores `user-scalable=no`, and only
   the canvas has `touch-action: none`, so a pinch or double tap on the toolbar or title
   bar can zoom or scroll the whole page. So can the keyboard opening for the board
   title. Against this: the toolbar would probably have looked moved or bigger, and
   leaving Safari wouldn't normally undo a zoom.

How to tell next time (with `?debug` on):
- **The ring and cross under the finger, but the ink is off:** the app's bug.
- **The ring and cross off from the finger too:** Safari or iPadOS is reporting the
  wrong position (cause 1). Take a screenshot.
- **The `visual viewport` line shows a scale other than 1.00, or an offset other than
  0,0:** the page got zoomed or scrolled (cause 2).
- Also note what was touched just before (toolbar button, title, top of the screen),
  and whether Safari was in Split View, Slide Over or Stage Manager.

Trying to make it happen on purpose: with the board open in a Safari window (not full
screen) and `?debug` on, move the window, resize it, and switch it to and from full
screen. After each, draw a short line and check the ink and the cross are under the
finger. If one of these triggers it, cause 1 is confirmed.

Possible fixes:
- Cause 2:
  - Stop the whole board page zooming or scrolling: `touch-action: none` on the board
    page, not just the canvas. Taps on buttons still work.
  - Scroll the page back to 0,0 whenever the visual viewport moves while nothing is
    being typed.
- Cause 1: probably nothing the app can fix. A note for students, "if ink lands in the
  wrong place, switch away from Safari and back", may be all there is.

### 2. The dot of an exclamation mark is often missed

What happened:
- Writing "!" (a short line about 10 mm long, then a dot) often lost the dot,
  especially with a light touch.
- A dot on its own was picked up, even when light.
- Pressing a bit harder, or moving the pen a little while dotting, made it work.
- The Pencil itself felt fine.

What the code does:
- A one-point stroke is drawn as a round dot whose size follows the pressure at the
  moment the pen touched down.
- Later samples at the same spot are skipped as repeats (`addPoint` in app.js ignores
  moves under 0.2 screen px), and **so is their pressure**.

Likely cause:
- A quick, light tap starts with almost no pressure (the Pencil reports pressure rising
  from near 0).
- The dot keeps that first pressure. At size 3, near-zero pressure gives a dot about
  1 px across, which is easy to miss.
- Pressing harder or moving a little adds samples with real pressure, so the dot grows.
- A careful dot on its own probably lasts longer, or moves a little.

Other possibilities (less likely):
- A dot that lands right after a stroke ends might be dropped if the touch-down arrives
  before the previous stroke has finished.
- Safari's handling of quick repeated Pencil taps.

How to tell next time (with `?debug` on):
- Write "!" lightly a few times and screenshot the event list.
- For each dot, check that a `down pen` line exists (if it's missing, the tap never
  reached the page) and what pressure it shows.
- After a missed dot, zoom in (pinch). If a tiny dot is there, it's the pressure cause.

Possible fixes:
- When the pen stays on the same spot, keep the highest pressure seen for that point,
  instead of the first one.
- Give a dot a minimum size, for example the pen's normal width.

Fix built 2026-11-07 (branch `claude/gifted-moore-d1b94f`): both of the above. A point
the pen stays on keeps the highest pressure seen there; if that point was already sent,
a small `stroke:pressure` message brings others and the saved board up to date. A dot is
never smaller than the pen's normal width. Tested in Chrome with simulated Pencil input
(a dot landing at pressure 0.02 and pressing to 0.6; a light tap that never presses
harder; going offline mid-dot): the dot looked the same in both tabs and on the server.
Still to check on the iPad: write "!" lightly several times, with `?debug` on.

## 2026-11-05 · iPad, finger and Apple Pencil (first iPad test)

Found four problems; they're logged as bugs in BACKLOG.md:
- Pencil ink landed 0.5–1 cm below the tip.
- The Pencil didn't draw while a palm was on the screen.
- Shifting the palm panned the page.
- The student link said "This board link doesn't work".

Also found: one finger does nothing after the Pencil has been used, which was confusing.
Decided: show a hint, not one-finger pan. Built 2026-11-07 (see BACKLOG.md, Next).

Fix notes for "This board link doesn't work" (2026-11-07, branch
`claude/gifted-moore-d1b94f`): the cause is still unknown, but next time there will be
something to go on. The server console logs every refused board with the requested ID
and the reason (bad ID, no file, or read error). Only a board that really doesn't exist
shows the "doesn't work" notice; a file that can't be read makes the page retry, like
being offline. The notice shows the board ID the page asked for. How to check next time:
- Read the server console for a line starting `Board "…" refused`.
- Compare the ID in the notice with the link from Copy student link.
