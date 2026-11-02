// Home page: list of lesson boards and the form for starting a new one.

const $ = (id) => document.getElementById(id);
const student = $('student');
const subject = $('subject');
const title = $('title');

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Default title: YYYY-MM-DD_Student_Subject (blank parts are left out).
function defaultTitle() {
  return [today(), student.value.trim(), subject.value.trim()].filter(Boolean).join('_');
}

// Keep the title in step with the other fields until the tutor edits it by hand.
let titleEdited = false;
title.value = defaultTitle();
title.addEventListener('input', () => { titleEdited = title.value.trim() !== ''; });
for (const el of [student, subject]) {
  el.addEventListener('input', () => { if (!titleEdited) title.value = defaultTitle(); });
}

$('newBoard').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const res = await fetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.value.trim() || defaultTitle() }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const board = await res.json();
    location.href = `/b/${board.id}`;
  } catch (err) {
    alert('Could not create the board: ' + err.message);
    button.disabled = false;
  }
});

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return dateFmt.format(ms);
}

async function loadBoards() {
  const list = $('boards');
  let boards = [];
  try {
    boards = await (await fetch('/api/boards')).json();
  } catch {
    list.innerHTML = '<li class="muted">Could not load boards. Is the server running?</li>';
    return;
  }
  list.innerHTML = '';
  $('empty').hidden = boards.length > 0;
  for (const b of boards) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/b/${b.id}`;
    const name = document.createElement('span');
    name.className = 'board-title';
    name.textContent = b.title;
    const info = document.createElement('span');
    info.className = 'muted';
    info.textContent = `${b.pageCount} page${b.pageCount === 1 ? '' : 's'} · created ${dateFmt.format(b.createdAt)} · edited ${timeAgo(b.updatedAt)}`;
    a.append(name, info);
    li.appendChild(a);
    list.appendChild(li);
  }
}

loadBoards();
// Refresh when coming back to this tab (e.g. after a lesson in another tab).
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadBoards(); });
