/* ===== Storage ===== */
const STORE_KEY = 'task-payment-tracker-v1';
const MAX_FILE = 1.5 * 1024 * 1024;

// number of tag colors (see [data-c] rules in style.css)
const TAG_COLORS = 8;

let state = load();

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
  if (!s) s = { tasks: [], payments: [], tags: { task: [], pay: [] } };
  // first run only: fill both tables with a few sample rows so the layout is visible
  if (!s.seeded && !s.tasks.length && !s.payments.length) {
    s.seeded = true;
    const day = (n) => {
      const x = new Date();
      x.setDate(x.getDate() + n);
      const p = (v) => String(v).padStart(2, '0');
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    };
    s.tags.task = [{ name: 'العمل', ci: 0 }, { name: 'شخصي', ci: 1 }, { name: 'دراسة', ci: 2 }];
    s.tags.pay = [{ name: 'أحمد', ci: 3 }, { name: 'سارة', ci: 4 }, { name: 'محمد', ci: 5 }];
    s.tasks = [
      { id: 1, title: 'تسليم تقرير المشروع', tags: ['العمل'], added: day(-3), due: day(2), file: null },
      { id: 2, title: 'حجز موعد الطبيب', tags: ['شخصي'], added: day(-1), due: day(5), file: null },
      { id: 3, title: 'مراجعة الفصل الثالث', tags: ['دراسة', 'شخصي'], added: day(-6), due: day(-1), file: null },
    ];
    s.payments = [
      { id: 11, title: 'سلفة للإيجار', tags: ['أحمد'], type: 'creditor', amount: 450, date: day(-10) },
      { id: 12, title: 'عشاء الأسبوع الماضي', tags: ['سارة'], type: 'debtor', amount: 60, date: day(-4) },
      { id: 13, title: 'ثمن الكتب', tags: ['محمد'], type: 'creditor', amount: 120.5, date: day(-2) },
    ];
  }
  // migrate tags saved by older versions (hex colors) to palette indexes
  ['task', 'pay'].forEach((k) => {
    s.tags[k].forEach((t, i) => { if (typeof t.ci !== 'number') t.ci = i % TAG_COLORS; });
  });
  return s;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    toast('تعذّر الحفظ: مساحة التخزين ممتلئة (ربما بسبب حجم الملفات).');
    return false;
  }
}

/* ===== Helpers ===== */
const $ = (id) => document.getElementById(id);

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

function formError(id, msg) {
  const p = $(id);
  p.textContent = msg;
  p.hidden = false;
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function applyColor(node, kind, name) {
  const t = state.tags[kind].find((x) => x.name === name);
  node.dataset.c = t ? t.ci : 6;
}

function makeTag(kind, name) {
  const t = el('span', 'tag', name);
  applyColor(t, kind, name);
  return t;
}

function cell(cls, ...children) {
  const td = el('td', cls);
  children.forEach((c) => td.append(c));
  return td;
}

function emptyRow(cols, text) {
  const tr = el('tr');
  const td = el('td', 'empty', text);
  td.colSpan = cols;
  tr.append(td);
  return tr;
}

function confirmAsk(message) {
  return new Promise((resolve) => {
    const dlg = $('confirmDialog');
    $('confirmText').textContent = message;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    dlg.showModal();
  });
}


/* ===== Tags: create / delete ===== */
function nextColor(kind) {
  const used = Array(TAG_COLORS).fill(0);
  state.tags[kind].forEach((t) => { used[t.ci]++; });
  return used.indexOf(Math.min(...used));
}

function ensureTag(kind, name) {
  if (!state.tags[kind].some((t) => t.name === name)) {
    state.tags[kind].push({ name, ci: nextColor(kind) });
    save();
  }
}

async function deleteTag(kind, name) {
  const key = kind === 'task' ? 'tasks' : 'payments';
  const used = state[key].filter((r) => r.tags.includes(name)).length;
  const msg = used
    ? `سيتم حذف "${name}" نهائياً وإزالته من ${used} من الصفوف.`
    : `سيتم حذف "${name}" نهائياً.`;
  if (!(await confirmAsk(msg))) return false;
  state.tags[kind] = state.tags[kind].filter((t) => t.name !== name);
  state[key].forEach((r) => { r.tags = r.tags.filter((n) => n !== name); });
  save();
  renderTasks();
  renderPayments();
  return true;
}

/* ===== Popup menu (tags / type) ===== */
const menuEl = el('div', 'menu');
menuEl.hidden = true;
document.body.append(menuEl);
let menuState = null;

function placeMenu() {
  const r = menuState.rect;
  const w = menuEl.offsetWidth;
  const view = document.documentElement.clientWidth;
  let left = r.right + window.scrollX - w;               // align to the cell's right edge (RTL)
  left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + view - w - 8));
  menuEl.style.left = left + 'px';
  menuEl.style.top = (r.bottom + window.scrollY + 4) + 'px';
}

function renderMenu() {
  menuEl.textContent = '';
  menuState.build(menuEl);
  placeMenu();
}

function openMenu(anchor, build) {
  menuState = { build, rect: anchor.getBoundingClientRect() };
  menuEl.hidden = false;
  renderMenu();
}

function closeMenu() {
  menuEl.hidden = true;
  menuState = null;
}

document.addEventListener('pointerdown', (e) => {
  if (menuState && !menuEl.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuState) closeMenu();
});

function tagMenu(kind, row, single, rerender) {
  let refocus = false;
  return (m) => {
    m.append(el('div', 'menu-head', single ? 'اختر شخصاً أو أضف جديداً' : 'اختر تصنيفات أو أضف جديداً'));

    const list = el('div', 'menu-list');
    state.tags[kind].forEach((t) => {
      const item = el('div', 'menu-item');

      const pick = el('button', 'menu-pick');
      pick.type = 'button';
      const tag = el('span', 'tag', t.name);
      tag.dataset.c = t.ci;
      pick.append(tag);
      if (row.tags.includes(t.name)) pick.append(el('span', 'check', '✓'));
      pick.onclick = () => {
        if (single) row.tags = row.tags.includes(t.name) ? [] : [t.name];
        else row.tags = row.tags.includes(t.name) ? row.tags.filter((n) => n !== t.name) : [...row.tags, t.name];
        save();
        rerender();
        renderMenu();
      };

      const del = el('button', 'menu-del', '×');
      del.type = 'button';
      del.title = 'حذف هذا التصنيف نهائياً';
      del.setAttribute('aria-label', 'حذف ' + t.name);
      del.onclick = async () => {
        closeMenu();
        await deleteTag(kind, t.name);
      };

      item.append(pick, del);
      list.append(item);
    });
    if (!state.tags[kind].length) list.append(el('div', 'menu-empty', 'لا توجد تصنيفات بعد'));
    m.append(list);

    const input = el('input', 'menu-input');
    input.type = 'text';
    input.maxLength = 30;
    input.placeholder = single ? 'اسم شخص جديد…' : 'تصنيف جديد…';
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      ensureTag(kind, name);
      if (single) row.tags = [name];
      else if (!row.tags.includes(name)) row.tags = [...row.tags, name];
      save();
      refocus = true;
      rerender();
      renderMenu();
    });
    m.append(input);
    if (refocus) { input.focus(); refocus = false; }
  };
}

function typeMenu(p) {
  return (m) => {
    m.append(el('div', 'menu-head', 'نوع الدفعة'));
    const list = el('div', 'menu-list');
    [['creditor', 'دائن (لي عنده)'], ['debtor', 'مدين (عليّ له)']].forEach(([v, label]) => {
      const item = el('div', 'menu-item');
      const pick = el('button', 'menu-pick');
      pick.type = 'button';
      pick.append(el('span', 'badge ' + v, label));
      if (p.type === v) pick.append(el('span', 'check', '✓'));
      pick.onclick = () => {
        p.type = v;
        save();
        closeMenu();
        renderPayments();
      };
      item.append(pick);
      list.append(item);
    });
    m.append(list);
  };
}

/* ===== Inline editing ===== */
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (!document.querySelector('.cell-input')) { renderTasks(); renderPayments(); }
  }, 200);
}

function editable(td, start, pickable) {
  td.classList.add('editable');
  if (pickable) td.classList.add('pickable');
  td.tabIndex = 0;
  td.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;
    start(td);
  });
  td.addEventListener('keydown', (e) => {
    if (e.target === td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); start(td); }
  });
  return td;
}

function inlineEdit(td, opts) {
  if (td.classList.contains('editing')) return;
  const { type, value, show, onSave } = opts;
  closeMenu();

  const input = el('input', 'cell-input');
  input.type = type;
  input.value = value === undefined || value === null ? '' : value;
  if (type === 'number') { input.min = '0'; input.step = 'any'; input.inputMode = 'decimal'; }
  td.textContent = '';
  td.classList.add('editing');
  td.append(input);
  input.focus();
  if (type !== 'date') input.select();

  let done = false;
  const finish = (commit, viaBlur) => {
    if (done) return;
    done = true;
    let ok = true;
    if (commit && input.value !== String(value ?? '')) {
      ok = onSave(input.value) !== false;
      if (!ok) toast('القيمة غير صالحة، لم يتم التعديل.');
    }
    if (viaBlur) {
      // keep the DOM until a possible click on another cell has been handled
      td.classList.remove('editing');
      td.textContent = show(commit && ok ? input.value : value);
      scheduleRender();
    } else {
      renderTasks();
      renderPayments();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true, false); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false, false); }
  });
  input.addEventListener('blur', () => finish(true, true));
}

function pickFile(task) {
  const fi = $('cellFile');
  fi.onchange = () => {
    const f = fi.files[0];
    fi.value = '';
    if (!f) return;
    if (f.size > MAX_FILE) { toast('حجم الملف أكبر من 1.5 ميغابايت.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const old = task.file;
      task.file = { name: f.name, data: reader.result };
      if (!save()) task.file = old;
      renderTasks();
    };
    reader.readAsDataURL(f);
  };
  fi.click();
}

/* ===== Tag picker ===== */
function TagPicker(box, kind, single) {
  const selected = new Set();
  const chips = el('div', 'chips');
  const addWrap = el('div', 'tag-add');
  const input = el('input');
  input.type = 'text';
  input.placeholder = single ? 'اسم شخص جديد' : 'تصنيف جديد';
  input.maxLength = 30;
  const addBtn = el('button', null, 'إضافة');
  addBtn.type = 'button';
  addWrap.append(input, addBtn);
  box.append(chips, addWrap);

  function render() {
    chips.innerHTML = '';
    state.tags[kind].forEach((t) => {
      const wrap = el('span', 'chip-wrap' + (selected.has(t.name) ? ' on' : ''));
      applyColor(wrap, kind, t.name);

      const b = el('button', 'chip', t.name);
      b.type = 'button';
      b.onclick = () => {
        if (single) {
          const was = selected.has(t.name);
          selected.clear();
          if (!was) selected.add(t.name);
        } else {
          selected.has(t.name) ? selected.delete(t.name) : selected.add(t.name);
        }
        render();
      };

      const x = el('button', 'chip-del', '×');
      x.type = 'button';
      x.title = 'حذف هذا التصنيف نهائياً';
      x.setAttribute('aria-label', 'حذف ' + t.name);
      x.onclick = async () => {
        if (await deleteTag(kind, t.name)) {
          selected.delete(t.name);
          render();
        }
      };

      wrap.append(b, x);
      chips.append(wrap);
    });
  }

  function addTag() {
    const name = input.value.trim();
    if (!name) return;
    ensureTag(kind, name);
    if (single) selected.clear();
    selected.add(name);
    input.value = '';
    render();
  }

  addBtn.onclick = addTag;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
  });

  render();
  return {
    get: () => [...selected],
    reset: () => { selected.clear(); input.value = ''; render(); },
  };
}

const taskPicker = TagPicker($('taskTags'), 'task', false);
const payPicker = TagPicker($('payTags'), 'pay', true);

/* ===== Tasks table ===== */
function renderTasks() {
  const body = $('taskBody');
  const foot = $('taskFoot');
  body.innerHTML = '';
  foot.innerHTML = '';

  const q = $('taskSearch').value.trim().toLowerCase();
  const rows = state.tasks
    .filter((t) => !q || (t.title + ' ' + t.tags.join(' ')).toLowerCase().includes(q))
    .sort((a, b) => a.due.localeCompare(b.due));

  if (!rows.length) {
    body.append(emptyRow(6, state.tasks.length ? 'لا نتائج' : 'لا توجد مهام بعد'));
  }

  const today = todayStr();
  rows.forEach((t) => {
    const late = t.due < today;
    const tr = el('tr');

    const tags = el('div', 'tags');
    t.tags.forEach((n) => tags.append(makeTag('task', n)));

    const fileTd = cell('');
    if (t.file) {
      const a = el('a', 'file', t.file.name);
      a.href = t.file.data;
      a.download = t.file.name;
      a.title = t.file.name;
      const rm = el('button', 'file-del', '×');
      rm.type = 'button';
      rm.title = 'إزالة الملف';
      rm.setAttribute('aria-label', 'إزالة الملف');
      rm.onclick = () => { t.file = null; save(); renderTasks(); };
      fileTd.append(a, rm);
    } else {
      fileTd.append(el('span', 'muted', '—'));
    }

    const done = el('button', 'done-btn', 'done?');
    done.onclick = async () => {
      if (await confirmAsk('هل انتهيت من هذه المهمة؟ سيتم حذفها نهائياً.')) {
        state.tasks = state.tasks.filter((x) => x.id !== t.id);
        save();
        renderTasks();
      }
    };

    const dateEdit = (field) => (td) => inlineEdit(td, {
      type: 'date',
      value: t[field],
      show: fmtDate,
      onSave: (v) => { if (!v) return false; t[field] = v; save(); },
    });

    tr.append(
      editable(cell('title', document.createTextNode(t.title)), (td) => inlineEdit(td, {
        type: 'text',
        value: t.title,
        show: (v) => v,
        onSave: (v) => { v = v.trim(); if (!v) return false; t.title = v; save(); },
      })),
      editable(cell('', tags), (td) => openMenu(td, tagMenu('task', t, false, renderTasks)), true),
      editable(cell('date', document.createTextNode(fmtDate(t.added))), dateEdit('added')),
      editable(cell('date' + (late ? ' late' : ''), document.createTextNode(fmtDate(t.due) + (late ? ' · متأخرة' : ''))), dateEdit('due')),
      editable(fileTd, () => pickFile(t), true),
      cell('narrow', done)
    );
    body.append(tr);
  });

  // calculation row
  const fr = el('tr');
  const c1 = el('td');
  c1.append(el('b', null, 'العدد'), document.createTextNode(String(rows.length)));
  fr.append(c1, el('td'), el('td'), el('td'), el('td'), el('td'));
  foot.append(fr);
}

/* ===== Payments table ===== */
function renderPayments() {
  const body = $('payBody');
  const foot = $('payFoot');
  body.innerHTML = '';
  foot.innerHTML = '';

  let cred = 0, debt = 0;
  state.payments.forEach((p) => {
    if (p.type === 'creditor') cred += Number(p.amount) || 0;
    else debt += Number(p.amount) || 0;
  });
  const net = cred - debt;
  $('payCaption').textContent =
    `لي عند الآخرين: ${fmt(cred)}  ·  عليّ للآخرين: ${fmt(debt)}  ·  الصافي: ${net > 0 ? '+' : ''}${fmt(net)}`;

  const q = $('paySearch').value.trim().toLowerCase();
  const rows = state.payments
    .filter((p) => !q || (p.title + ' ' + p.tags.join(' ')).toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!rows.length) {
    body.append(emptyRow(6, state.payments.length ? 'لا نتائج' : 'لا توجد دفعات بعد'));
  }

  rows.forEach((p) => {
    const tr = el('tr');

    const tags = el('div', 'tags');
    p.tags.forEach((n) => tags.append(makeTag('pay', n)));

    const badge = el('span', 'badge ' + p.type, p.type === 'creditor' ? 'دائن' : 'مدين');

    const sign = p.type === 'creditor' ? '+' : '−';
    const hasAmount = p.amount !== undefined && p.amount !== null && p.amount !== '';
    const amountText = hasAmount ? sign + fmt(p.amount) : '—';

    const done = el('button', 'done-btn', 'done?');
    done.onclick = async () => {
      if (await confirmAsk('هل تمت تسوية هذه الدفعة؟ سيتم حذفها نهائياً.')) {
        state.payments = state.payments.filter((x) => x.id !== p.id);
        save();
        renderPayments();
      }
    };

    tr.append(
      editable(cell('title', document.createTextNode(p.title)), (td) => inlineEdit(td, {
        type: 'text',
        value: p.title,
        show: (v) => v,
        onSave: (v) => { v = v.trim(); if (!v) return false; p.title = v; save(); },
      })),
      editable(cell('', tags), (td) => openMenu(td, tagMenu('pay', p, true, renderPayments)), true),
      editable(cell('', badge), (td) => openMenu(td, typeMenu(p)), true),
      editable(cell('amount ' + p.type, document.createTextNode(amountText)), (td) => inlineEdit(td, {
        type: 'number',
        value: hasAmount ? p.amount : '',
        show: (v) => (v === '' || v === null || isNaN(parseFloat(v)) ? '—' : sign + fmt(v)),
        onSave: (v) => { const n = parseFloat(v); if (isNaN(n) || n < 0) return false; p.amount = n; save(); },
      })),
      editable(cell('date', document.createTextNode(fmtDate(p.date))), (td) => inlineEdit(td, {
        type: 'date',
        value: p.date,
        show: fmtDate,
        onSave: (v) => { if (!v) return false; p.date = v; save(); },
      })),
      cell('narrow', done)
    );
    body.append(tr);
  });

  // calculation row
  const shown = rows.reduce((s, p) => s + (p.type === 'creditor' ? 1 : -1) * (Number(p.amount) || 0), 0);
  const fr = el('tr');
  const c1 = el('td');
  c1.append(el('b', null, 'العدد'), document.createTextNode(String(rows.length)));
  const c4 = el('td');
  c4.append(el('b', null, 'المجموع'), document.createTextNode((shown > 0 ? '+' : '') + fmt(shown)));
  fr.append(c1, el('td'), el('td'), c4, el('td'), el('td'));
  foot.append(fr);
}

$('taskSearch').addEventListener('input', renderTasks);
$('paySearch').addEventListener('input', renderPayments);

/* ===== Dialogs ===== */
function openTaskDialog() {
  $('taskForm').reset();
  $('taskError').hidden = true;
  $('taskAdded').value = todayStr();
  taskPicker.reset();
  $('taskDialog').showModal();
}

function openPayDialog() {
  $('payForm').reset();
  $('payError').hidden = true;
  $('payDate').value = todayStr();
  payPicker.reset();
  $('payDialog').showModal();
}

document.querySelectorAll('[data-open]').forEach((b) => {
  b.onclick = () => (b.dataset.open === 'task' ? openTaskDialog() : openPayDialog());
});

document.querySelectorAll('[data-close]').forEach((b) => {
  b.onclick = () => b.closest('dialog').close();
});

/* ===== Save task ===== */
$('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('taskTitle').value.trim();
  const added = $('taskAdded').value;
  const due = $('taskDue').value;
  if (!title || !added || !due) { formError('taskError', 'يرجى تعبئة الحقول المطلوبة.'); return; }

  const task = { id: Date.now(), title, tags: taskPicker.get(), added, due, file: null };
  const file = $('taskFile').files[0];

  const finish = () => {
    state.tasks.push(task);
    if (!save()) { state.tasks.pop(); return; }
    $('taskDialog').close();
    renderTasks();
  };

  if (!file) return finish();
  if (file.size > MAX_FILE) { formError('taskError', 'حجم الملف أكبر من 1.5 ميغابايت.'); return; }

  const reader = new FileReader();
  reader.onload = () => { task.file = { name: file.name, data: reader.result }; finish(); };
  reader.readAsDataURL(file);
});

/* ===== Save payment ===== */
$('payForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('payTitle').value.trim();
  const date = $('payDate').value;
  const amount = parseFloat($('payAmount').value);
  if (!title || !date) { formError('payError', 'يرجى تعبئة الحقول المطلوبة.'); return; }
  if (isNaN(amount) || amount < 0) { formError('payError', 'يرجى إدخال مبلغ صحيح.'); return; }

  state.payments.push({
    id: Date.now(),
    title,
    tags: payPicker.get(),
    type: document.querySelector('input[name="payType"]:checked').value,
    amount,
    date,
  });
  save();
  $('payDialog').close();
  renderPayments();
});

/* ===== Start ===== */
renderTasks();
renderPayments();
