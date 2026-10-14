/* ===== التخزين ===== */
const STORE_KEY = 'task-payment-tracker-v1';
const PALETTE = ['#3b82f6', '#0ea5a4', '#8b5cf6', '#e11d48', '#d97706', '#16a34a', '#db2777', '#475569'];
const MAX_FILE = 1.5 * 1024 * 1024;

let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) return s;
  } catch (e) {}
  return { tasks: [], payments: [], tags: { task: [], pay: [] } };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    alert('تعذّر الحفظ: مساحة التخزين ممتلئة (ربما بسبب حجم الملفات).');
    return false;
  }
}

/* ===== أدوات مساعدة ===== */
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

function tagColor(kind, name) {
  const t = state.tags[kind].find((x) => x.name === name);
  return t ? t.color : '#6b7280';
}

function tagsRow(kind, names) {
  const row = el('div', 'tags');
  names.forEach((n) => {
    const t = el('span', 'tag', n);
    t.style.setProperty('--c', tagColor(kind, n));
    row.append(t);
  });
  return row;
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

/* ===== منتقي التصنيفات (Tags) ===== */
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
      const b = el('button', 'chip' + (selected.has(t.name) ? ' on' : ''), t.name);
      b.type = 'button';
      b.style.setProperty('--c', t.color);
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
      chips.append(b);
    });
  }

  function addTag() {
    const name = input.value.trim();
    if (!name) return;
    if (!state.tags[kind].some((t) => t.name === name)) {
      state.tags[kind].push({ name, color: PALETTE[state.tags[kind].length % PALETTE.length] });
      save();
    }
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
    render,
  };
}

const taskPicker = TagPicker($('taskTags'), 'task', false);
const payPicker = TagPicker($('payTags'), 'pay', true);

/* ===== العرض ===== */
function renderTasks() {
  const list = $('taskList');
  list.innerHTML = '';
  $('taskCount').textContent = state.tasks.length;

  if (!state.tasks.length) {
    list.append(el('div', 'empty', 'لا توجد مهام بعد'));
    return;
  }

  const today = todayStr();
  [...state.tasks]
    .sort((a, b) => a.due.localeCompare(b.due))
    .forEach((t) => {
      const late = t.due < today;
      const card = el('div', 'item' + (late ? ' overdue' : ''));
      card.append(el('h4', null, t.title));
      if (t.tags.length) card.append(tagsRow('task', t.tags));

      const meta = el('div', 'meta');
      meta.append(el('span', null, 'الإضافة: ' + t.added));
      meta.append(el('span', late ? 'late' : '', 'الانتهاء: ' + t.due + (late ? ' (متأخرة)' : '')));
      card.append(meta);

      if (t.file) {
        const a = el('a', 'file', '📎 ' + t.file.name);
        a.href = t.file.data;
        a.download = t.file.name;
        card.append(a);
        card.append(el('br'));
      }

      const done = el('button', 'done-btn', 'done?');
      done.onclick = async () => {
        if (await confirmAsk('هل انتهيت من هذه المهمة؟ سيتم حذفها نهائياً.')) {
          state.tasks = state.tasks.filter((x) => x.id !== t.id);
          save();
          renderTasks();
        }
      };
      card.append(done);
      list.append(card);
    });
}

function renderPayments() {
  const list = $('payList');
  list.innerHTML = '';
  $('payCount').textContent = state.payments.length;

  if (!state.payments.length) {
    list.append(el('div', 'empty', 'لا توجد دفعات بعد'));
    return;
  }

  [...state.payments]
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((p) => {
      const card = el('div', 'item ' + p.type);
      card.append(el('h4', null, p.title));

      const row = el('div', 'tags');
      row.append(el('span', 'badge ' + p.type, p.type === 'creditor' ? 'دائن' : 'مدين'));
      p.tags.forEach((n) => {
        const t = el('span', 'tag', n);
        t.style.setProperty('--c', tagColor('pay', n));
        row.append(t);
      });
      card.append(row);

      const meta = el('div', 'meta');
      meta.append(el('span', null, 'التاريخ: ' + p.date));
      card.append(meta);

      const done = el('button', 'done-btn', 'done?');
      done.onclick = async () => {
        if (await confirmAsk('هل تمت تسوية هذه الدفعة؟ سيتم حذفها نهائياً.')) {
          state.payments = state.payments.filter((x) => x.id !== p.id);
          save();
          renderPayments();
        }
      };
      card.append(done);
      list.append(card);
    });
}

/* ===== فتح وإغلاق النوافذ ===== */
$('openTask').onclick = () => {
  $('taskForm').reset();
  $('taskAdded').value = todayStr();
  taskPicker.reset();
  $('taskDialog').showModal();
};

$('openPay').onclick = () => {
  $('payForm').reset();
  $('payDate').value = todayStr();
  payPicker.reset();
  $('payDialog').showModal();
};

document.querySelectorAll('[data-close]').forEach((b) => {
  b.onclick = () => b.closest('dialog').close();
});

/* ===== حفظ مهمة ===== */
$('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('taskTitle').value.trim();
  const added = $('taskAdded').value;
  const due = $('taskDue').value;
  if (!title || !added || !due) { alert('يرجى تعبئة الحقول المطلوبة.'); return; }

  const task = { id: Date.now(), title, tags: taskPicker.get(), added, due, file: null };
  const file = $('taskFile').files[0];

  const finish = () => {
    state.tasks.push(task);
    if (!save()) { state.tasks.pop(); return; }
    $('taskDialog').close();
    renderTasks();
  };

  if (!file) return finish();
  if (file.size > MAX_FILE) { alert('حجم الملف أكبر من 1.5 ميغابايت.'); return; }

  const reader = new FileReader();
  reader.onload = () => { task.file = { name: file.name, data: reader.result }; finish(); };
  reader.readAsDataURL(file);
});

/* ===== حفظ دفعة ===== */
$('payForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('payTitle').value.trim();
  const date = $('payDate').value;
  if (!title || !date) { alert('يرجى تعبئة الحقول المطلوبة.'); return; }

  state.payments.push({
    id: Date.now(),
    title,
    tags: payPicker.get(),
    type: document.querySelector('input[name="payType"]:checked').value,
    date,
  });
  save();
  $('payDialog').close();
  renderPayments();
});

/* ===== البدء ===== */
renderTasks();
renderPayments();
