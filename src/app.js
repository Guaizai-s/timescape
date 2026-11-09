import { addDays, dateKey, dayNumber, daySegment, displayDate, exampleEntries, isDateKey, parseQuickEntry, startOfWeek, timeLabel, weekdays } from './schedule.js';
import { entriesOnDate, loadSchedule, normalizeEntry, normalizeSchedule, saveSchedule, STORAGE_KEY, validateEntry } from './data/repository.js';
import { ScheduleMap } from './map/controller.js';

const $ = (selector) => document.querySelector(selector);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const today = dateKey();
const editor = $('#editor');
const form = $('#editor-form');
const field = (name) => form.elements.namedItem(name);
let editingId = null;
let toastTimer;
let undoAction = null;
let toastFocusTarget = null;
const toast = $('#announcement');
const undoButton = $('#undo-action');

let storageReadError = false;
function load() {
  try {
    return loadSchedule(today);
  } catch {
    storageReadError = true;
    const message = $('#storage-message');
    message.textContent = '现有数据读取失败。请先从更多选项导出备份，再检查浏览器存储；原数据不会被覆盖。';
    message.hidden = false;
    return normalizeSchedule({ entries: [], theme: 'system' });
  }
}

let data = load();
const view = { tab: 'today', day: today, mapDate: today };

function save(next) {
  if (storageReadError) {
    announce('请先处理数据读取错误，原数据尚未改动。', { tone: 'error' });
    return false;
  }
  try {
    data = saveSchedule(next);
  } catch {
    announce('无法保存，请检查浏览器存储。', { tone: 'error' });
    return false;
  }
  return true;
}

function animate(element, frames, duration = 180) {
  if (reducedMotion.matches || !element) return;
  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate(frames, { duration, easing: 'cubic-bezier(.2, 0, 0, 1)' });
}

function reveal(element) {
  animate(element, [{ opacity: .5, translate: '0 6px' }, { opacity: 1, translate: '0 0' }]);
}

function dismissAnnouncement() {
  clearTimeout(toastTimer);
  if (toast.contains(document.activeElement)) {
    (toastFocusTarget?.isConnected ? toastFocusTarget : $('#new-entry')).focus({ preventScroll: true });
  }
  toast.hidden = true;
  undoAction = null;
  undoButton.hidden = true;
}

function scheduleAnnouncementDismiss() {
  clearTimeout(toastTimer);
  if (toast.hidden || toast.contains(document.activeElement) || toast.matches(':hover')) return;
  toastTimer = setTimeout(dismissAnnouncement, undoAction ? 8000 : 3000);
}

function announce(text, { undo = null, tone = 'success' } = {}) {
  if (!toast.contains(document.activeElement)) toastFocusTarget = document.activeElement;
  else if (!undo) (toastFocusTarget?.isConnected ? toastFocusTarget : $('#new-entry')).focus({ preventScroll: true });
  undoAction = undo;
  $('#announcement-text').textContent = text;
  toast.dataset.tone = tone;
  $('.toast-icon').innerHTML = tone === 'error'
    ? '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4v.1"/>'
    : '<path d="m5 12 4 4L19 6"/>';
  undoButton.hidden = !undo;
  toast.hidden = false;
  reveal(toast);
  scheduleAnnouncementDismiss();
}

toast.addEventListener('pointerenter', () => clearTimeout(toastTimer));
toast.addEventListener('pointerleave', scheduleAnnouncementDismiss);
toast.addEventListener('focusin', () => clearTimeout(toastTimer));
toast.addEventListener('focusout', () => queueMicrotask(scheduleAnnouncementDismiss));
undoButton.addEventListener('click', () => {
  const restore = undoAction;
  dismissAnnouncement();
  restore?.();
});

function ripple(control, clientX, clientY) {
  if (reducedMotion.matches || control.disabled || control.dataset.noRipple === 'true') return;
  const bounds = control.getBoundingClientRect();
  const ink = node('span', 'ink-ripple');
  const size = Math.hypot(bounds.width, bounds.height) * 2;
  ink.setAttribute('aria-hidden', 'true');
  ink.style.width = ink.style.height = `${size}px`;
  ink.style.left = `${clientX - bounds.left - size / 2}px`;
  ink.style.top = `${clientY - bounds.top - size / 2}px`;
  control.append(ink);
  ink.addEventListener('animationend', () => ink.remove(), { once: true });
  ink.addEventListener('animationcancel', () => ink.remove(), { once: true });
}

document.addEventListener('pointerdown', (event) => {
  const control = event.target.closest('button');
  if (event.button === 0 && control) ripple(control, event.clientX, event.clientY);
});
document.addEventListener('click', (event) => {
  const control = event.target.closest('button');
  if (event.detail === 0 && control) {
    const bounds = control.getBoundingClientRect();
    ripple(control, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }
});

function highlightEntry(id) {
  if (view.tab === 'map') {
    scheduleMap.focusEntry(id);
    requestAnimationFrame(() => {
      Array.from(document.querySelectorAll('.map-node')).find((element) => element.dataset.entryId === id)?.focus({ preventScroll: true });
    });
    return;
  }
  const control = Array.from(document.querySelectorAll('[data-entry-id]'))
    .find((element) => element.dataset.entryId === id && element.getClientRects().length);
  if (!control) return;
  control.focus({ preventScroll: true });
  control.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  animate(control, [
    { outline: `2px solid ${color}`, outlineOffset: '3px' },
    { outline: '2px solid transparent', outlineOffset: '3px' },
  ], 900);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(className, text, onClick) {
  const element = node('button', className, text);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

const sun = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.7-1.4 1.4M6.7 17.3l-1.4 1.4m13.4 0-1.4-1.4M6.7 6.7 5.3 5.3"/></svg>';
const moon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.8 8.8 0 0 1 9.8 3.5a8.8 8.8 0 1 0 10.7 10.7Z"/></svg>';
const categoryIcons = {
  '课程': '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z"/>',
  '备考': '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 7h6m-6 5h6m-6 4h3"/>',
  '校园': '<path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/>',
  '生活': '<path d="M5 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Zm12 1h2a3 3 0 0 1 0 6h-2M8 3v2m5-2v2"/>',
};

function renderTheme() {
  const theme = data.theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : data.theme;
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  const toggle = $('#theme-button');
  toggle.innerHTML = dark ? sun : moon;
  toggle.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到暗色模式');
  toggle.title = toggle.getAttribute('aria-label');
  $('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
}

$('#theme-button').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  if (save({ ...data, theme })) {
    renderTheme();
    animate($('#theme-button svg'), [{ rotate: '-30deg', scale: .7 }, { rotate: '0deg', scale: 1 }], 220);
  }
});
systemTheme.addEventListener('change', renderTheme);

function entryButton(entry, className) {
  const control = button(className, undefined, () => openEditor(entry));
  control.dataset.category = entry.category;
  control.dataset.entryId = entry.id;
  const kind = { event: '日程', task: entry.done ? '已完成待办' : '待办', notice: '仅知晓' }[entry.kind];
  control.setAttribute('aria-label', `${entry.title}，${kind}，${entry.category}，${timeLabel(entry)}`);
  control.append(node('span', 'entry-name', entry.title));
  if (entry.done) control.classList.add('is-done');
  return control;
}

function renderTimeline(entries) {
  const timeline = $('#timeline');
  const timed = entries.filter(({ kind, start }) => kind === 'event' || kind === 'task' && start).sort((a, b) => {
    const first = daySegment(a, view.day);
    const second = daySegment(b, view.day);
    return Number(second.allDay) - Number(first.allDay) || first.start.localeCompare(second.start);
  });
  if (!timed.length) {
    timeline.replaceChildren(node('p', 'empty-state', '暂无日程'));
    return;
  }

  const list = node('ol', 'timeline-list');
  for (const entry of timed) {
    const segment = daySegment(entry, view.day);
    const row = node('li', 'timeline-row');
    row.dataset.category = entry.category;
    const time = node('div', 'timeline-time');
    const start = node('time', 'time-start', segment.allDay ? '全天' : segment.start);
    start.dateTime = segment.allDay ? view.day : `${view.day}T${segment.start}`;
    time.append(start);
    if (!segment.allDay && segment.end) {
      const end = node('time', 'time-end', segment.end);
      end.dateTime = segment.end === '24:00' ? `${addDays(view.day, 1)}T00:00` : `${view.day}T${segment.end}`;
      time.append(end);
    }
    const card = entryButton(entry, 'event-card');
    const icon = node('span', 'event-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 24 24">${categoryIcons[entry.category] || categoryIcons['生活']}</svg>`;
    card.prepend(icon);
    const arrow = node('span', 'entry-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
    if (entry.endDate !== entry.date) {
      const copy = node('span', 'event-copy');
      copy.append(card.querySelector('.entry-name'), node('span', 'event-span', `${displayDate(entry.date)} — ${displayDate(entry.endDate)}`));
      card.append(copy);
    }
    card.append(arrow);
    row.append(time, card);
    list.append(row);
  }
  timeline.replaceChildren(list);
}

function toggleTask(entry, checkbox) {
  const entries = data.entries.map((item) => item.id === entry.id ? { ...item, done: !item.done } : item);
  if (save({ ...data, entries })) {
    const dayEntries = entriesOnDate(data.entries, view.day);
    renderTasks(dayEntries);
    renderTimeline(dayEntries);
    const check = Array.from(document.querySelectorAll('.task-check')).find((item) => item.value === entry.id);
    check?.focus({ preventScroll: true });
    animate(check, [{ scale: .7 }, { scale: 1.15, offset: .6 }, { scale: 1 }], 260);
    announce(entry.done ? `已恢复「${entry.title}」` : `已完成「${entry.title}」`, {
      undo: () => {
        if (!data.entries.some(({ id }) => id === entry.id)) {
          announce('这项待办已删除', { tone: 'error' });
          return;
        }
        const restored = data.entries.map((item) => item.id === entry.id ? { ...item, done: entry.done } : item);
        if (save({ ...data, entries: restored })) {
          showView(view.tab, false);
          Array.from(document.querySelectorAll('.task-check')).find((item) => item.value === entry.id)?.focus({ preventScroll: true });
          announce('已撤销');
        }
      },
    });
  } else {
    checkbox.checked = entry.done;
  }
}

function renderTasks(entries) {
  const tasks = entries.filter(({ kind }) => kind === 'task');
  const taskList = $('#task-list');
  const list = node('ul', 'task-list');
  for (const entry of tasks) {
    const row = node('li', 'task-row');
    row.dataset.category = entry.category;
    if (entry.done) row.classList.add('is-done');
    const mark = node('span', 'task-mark');
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = `<svg viewBox="0 0 24 24">${categoryIcons[entry.category] || categoryIcons['生活']}</svg>`;
    const toggle = node('label', 'task-toggle');
    const checkbox = node('input', 'task-check');
    checkbox.type = 'checkbox';
    checkbox.value = entry.id;
    checkbox.checked = entry.done;
    checkbox.setAttribute('aria-label', `${entry.done ? '取消完成' : '完成'}${entry.title}`);
    checkbox.addEventListener('change', () => toggleTask(entry, checkbox));
    toggle.append(checkbox);
    const details = node('div', 'task-details');
    details.append(entryButton(entry, 'task-title'));
    const linked = data.entries.find(({ id }) => id === entry.linkId);
    if (linked) {
      const chip = button('link-chip', linked.title, () => openEditor(linked));
      chip.setAttribute('aria-label', `查看关联日程 ${linked.title}`);
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<path d="m10 13 4-4m-6 1-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-6 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>';
      chip.prepend(icon);
      details.append(chip);
    }
    row.append(mark, details, toggle);
    list.append(row);
  }
  taskList.replaceChildren(tasks.length ? list : node('p', 'empty-state', '暂无待办'));

  const notices = entries.filter(({ kind }) => kind === 'notice').map((entry) => {
    const card = entryButton(entry, 'notice-card');
    const icon = node('span', 'notice-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5m0-9v.1"/></svg>';
    card.prepend(icon);
    return card;
  });
  $('#notice-list').replaceChildren(...notices);
}

function renderWeekStrip() {
  const strip = $('#week-strip');
  const week = startOfWeek(view.day);
  const current = dateKey();
  strip.setAttribute('aria-label', `${displayDate(week)}到${displayDate(addDays(week, 6))}`);
  if (strip.dataset.week !== week) {
    strip.dataset.week = week;
    strip.replaceChildren(...Array.from({ length: 7 }, (_, index) => {
      const day = addDays(week, index);
      const control = button('week-date', undefined, () => {
        if (view.day === day) return;
        view.day = day;
        renderToday(true);
        control.focus({ preventScroll: true });
      });
      control.dataset.day = day;
      const label = node('span', 'week-label', weekdays[(index + 1) % 7]);
      const number = node('span', 'week-number', String(Number(day.slice(-2))));
      control.append(label, number);
      return control;
    }));
  }
  for (const control of strip.children) {
    const day = control.dataset.day;
    const hasEntries = entriesOnDate(data.entries, day).length > 0;
    control.setAttribute('aria-pressed', String(day === view.day));
    control.setAttribute('aria-label', `${displayDate(day, true)}${hasEntries ? '，有安排' : ''}`);
    if (day === current) control.setAttribute('aria-current', 'date');
    else control.removeAttribute('aria-current');
    control.classList.toggle('has-entries', hasEntries);
  }
}

function renderToday(withFeedback = false) {
  const isToday = view.day === dateKey();
  $('#day-heading').textContent = isToday ? '今天' : '日程';
  $('#day-caption').textContent = displayDate(view.day);
  $('#day-picker').value = view.day;
  $('#timeline-title').textContent = isToday ? '今日行程' : '当日行程';
  $('#tasks-title').textContent = isToday ? '今日待办' : '当日待办';
  const entries = entriesOnDate(data.entries, view.day);
  renderWeekStrip();
  renderTimeline(entries);
  renderTasks(entries);
  if (withFeedback) reveal($('.day-columns'));
}

const scheduleMap = new ScheduleMap($('#map-panel'), {
  onOpenEntry: (entry) => openEditor(entry),
  onSelectDate: (day) => { view.day = day; showView('today'); $('#day-picker').focus({ preventScroll: true }); },
  onDateChange: (day) => { view.mapDate = day; },
});

function renderDemoButton() {
  $('#demo-button').textContent = data.entries.some(({ demo }) => demo) ? '清除示例日程' : '载入示例日程';
}

function showView(tab, resetScroll = true) {
  const changedTab = tab !== view.tab;
  view.tab = tab;
  $('#today-view').hidden = tab !== 'today';
  $('#map-view').hidden = tab !== 'map';
  for (const control of document.querySelectorAll('[data-view]')) {
    if (control.dataset.view === tab) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  }
  if (tab === 'today') renderToday();
  else scheduleMap.update(data.entries);
  renderDemoButton();
  if (resetScroll) window.scrollTo(0, 0);
  if (changedTab) reveal(tab === 'today' ? $('#today-view') : $('#map-view'));
}

for (const control of document.querySelectorAll('[data-view]')) {
  control.addEventListener('click', () => {
    if (control.dataset.view === 'today') view.day = dateKey();
    showView(control.dataset.view);
  });
}

$('#day-picker').addEventListener('change', (event) => {
  if (!isDateKey(event.target.value)) { event.target.value = view.day; return; }
  view.day = event.target.value;
  renderToday(true);
});

$('#more-menu').addEventListener('toggle', (event) => {
  if (event.newState === 'open') reveal(event.currentTarget);
});

$('#export-button').addEventListener('click', () => {
  $('#more-menu').hidePopover();
  try {
    const content = storageReadError ? localStorage.getItem(STORAGE_KEY) : JSON.stringify(data, null, 2);
    if (!content) throw new Error('没有可导出的数据。');
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `timescape-${dateKey()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('已导出备份');
  } catch {
    announce('无法导出，请检查浏览器存储权限。', { tone: 'error' });
  }
});

$('#import-button').addEventListener('click', () => {
  $('#more-menu').hidePopover();
  $('#import-file').click();
});
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('备份文件不能超过 5 MB。');
    const imported = normalizeSchedule(JSON.parse(await file.text()));
    const existing = new Set(data.entries.map(({ id }) => id));
    const added = imported.entries.filter(({ id }) => !existing.has(id));
    if (!added.length) { announce('没有新的安排，同编号记录已保留'); return; }
    const addedIds = new Set(added.map(({ id }) => id));
    if (save({ ...data, entries: [...data.entries, ...added] })) {
      showView(view.tab, false);
      announce(`已导入 ${added.length} 项安排`, {
        undo: () => {
          if (save({ ...data, entries: withoutEntries(addedIds) })) {
            showView(view.tab, false);
            announce('已撤销导入');
          }
        },
      });
    }
  } catch (error) {
    announce(error instanceof SyntaxError ? '备份不是有效的 JSON 文件。' : error.message, { tone: 'error' });
  }
});

function withoutEntries(ids) {
  return data.entries.filter(({ id }) => !ids.has(id)).map((entry) => ids.has(entry.linkId) ? { ...entry, linkId: '' } : entry);
}

$('#demo-button').addEventListener('click', () => {
  $('#more-menu').hidePopover();
  const demoIds = new Set(data.entries.filter(({ demo }) => demo).map(({ id }) => id));
  const entries = demoIds.size ? withoutEntries(demoIds) : [...data.entries, ...exampleEntries(dateKey()).filter(({ id }) => !data.entries.some((entry) => entry.id === id))];
  if (save({ ...data, entries })) {
    if (!demoIds.size) {
      view.day = dateKey();
      view.mapDate = view.day;
    }
    showView(view.tab, false);
    announce(demoIds.size ? '已清除示例日程' : '已载入示例日程');
  }
});

function showFormMessage(message = '') {
  const element = $('#form-message');
  element.textContent = message;
  element.hidden = !message;
  if (message) reveal(element);
}

function updateFormFields() {
  const kind = field('kind').value;
  if (kind === 'notice') field('allDay').checked = true;
  const allDay = field('allDay').checked;
  $('#all-day-field').hidden = kind === 'notice';
  $('#time-fields').hidden = allDay;
  field('start').required = !allDay;
  field('end').required = !allDay && field('date').value !== field('endDate').value;
  field('start').disabled = allDay;
  field('end').disabled = allDay;
  field('endDate').min = field('date').value || '0001-01-01';
  $('#link-field').hidden = kind !== 'task';
  const linked = $('#linked-tasks');
  linked.hidden = kind !== 'event' || !linked.childElementCount;
}

function draftDate() {
  return view.tab === 'map' ? view.mapDate : view.day;
}

function fillDetails(entry) {
  field('title').value = entry.title || '';
  field('kind').value = entry.kind || 'event';
  field('date').value = entry.date ?? draftDate();
  field('date').dataset.previous = field('date').value;
  field('endDate').value = entry.endDate ?? field('date').value;
  field('allDay').checked = entry.allDay ?? (entry.kind === 'notice' || entry.kind === 'task' && !entry.start);
  field('start').value = entry.start || '';
  field('end').value = entry.end || '';
}

function openEditor(entry = {}) {
  editingId = entry.id || null;
  $('#editor-heading').textContent = editingId ? '编辑安排' : '新建安排';
  $('#delete-entry').hidden = !editingId;
  $('#quick-add').hidden = Boolean(editingId);
  $('#quick-text').value = '';
  $('#quick-result').textContent = '';
  fillDetails(entry);
  field('category').value = entry.category || '生活';
  const options = [new Option('不关联', '')];
  for (const item of data.entries.filter((item) => item.kind === 'event' && item.id !== editingId).sort((a, b) => a.date.localeCompare(b.date))) {
    options.push(new Option(`${item.title} · ${displayDate(item.date)}`, item.id));
  }
  field('linkId').replaceChildren(...options);
  field('linkId').value = entry.linkId || '';
  const linked = data.entries.filter((item) => item.linkId && item.linkId === editingId);
  $('#linked-tasks').replaceChildren(...(linked.length ? [
    node('p', '', '关联待办'),
    ...linked.map((task) => button('link-chip', `${task.done ? '已完成 · ' : ''}${task.title}`, () => openEditor(task))),
  ] : []));
  updateFormFields();
  showFormMessage();
  if (!editor.open) {
    editor.showModal();
    reveal(editor);
  }
  editor.scrollTop = 0;
}

field('kind').addEventListener('change', updateFormFields);
field('allDay').addEventListener('change', updateFormFields);
field('endDate').addEventListener('change', updateFormFields);
field('date').addEventListener('change', () => {
  const previous = field('date').dataset.previous;
  const next = field('date').value;
  if (isDateKey(next)) {
    const duration = isDateKey(previous) && isDateKey(field('endDate').value) ? Math.max(0, dayNumber(field('endDate').value) - dayNumber(previous)) : 0;
    const newEnd = addDays(next, duration);
    field('endDate').value = isDateKey(newEnd) ? newEnd : next;
    field('date').dataset.previous = next;
  }
  updateFormFields();
});
const addButton = $('#new-entry');
const addOptions = $('#add-options');
const addScrim = $('#add-scrim');

function setAddMenu(open) {
  if (open && $('#more-menu').matches(':popover-open')) $('#more-menu').hidePopover();
  addOptions.hidden = !open;
  addScrim.hidden = !open;
  addButton.setAttribute('aria-expanded', String(open));
  addButton.setAttribute('aria-label', open ? '关闭新建菜单' : '新建安排');
  for (const selector of ['.masthead', '#main', '.bottom-nav']) $(selector).inert = open;
  if (open) {
    reveal(addOptions);
    addOptions.firstElementChild.focus({ preventScroll: true });
  }
  else addButton.focus({ preventScroll: true });
}

addButton.addEventListener('click', () => setAddMenu(addOptions.hidden));
addScrim.addEventListener('click', () => setAddMenu(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !addOptions.hidden) setAddMenu(false);
});
for (const option of addOptions.querySelectorAll('[data-new-kind]')) {
  option.addEventListener('click', () => {
    setAddMenu(false);
    openEditor({ kind: option.dataset.newKind });
  });
}
$('#close-editor').addEventListener('click', () => editor.close());

$('#quick-add').addEventListener('submit', (event) => {
  event.preventDefault();
  const draft = $('#quick-text').value.trim();
  if (!draft) return;
  const entry = parseQuickEntry(draft, dateKey(), field('date').value || draftDate());
  const selectedKind = field('kind').value;
  const kind = /^(仅知晓|知晓|待办)/.test(draft) ? entry.kind : ['task', 'notice'].includes(selectedKind) ? selectedKind : entry.kind;
  const details = { ...entry, kind, allDay: kind === 'notice' || entry.allDay };
  fillDetails(details);
  updateFormFields();
  showFormMessage();
  $('#quick-result').textContent = entry.warning || `${displayDate(entry.date)} · ${timeLabel(details)}`;
  $('#quick-result').dataset.tone = entry.warning ? 'warning' : 'success';
  reveal($('.editor-fields'));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const previous = data.entries.find(({ id }) => id === editingId);
  const { title, kind, category, date, endDate, start, end, linkId } = Object.fromEntries(new FormData(form));
  if (!title.trim()) {
    showFormMessage('请输入安排名称。');
    field('title').focus();
    return;
  }
  const entry = normalizeEntry({
    id: editingId || Array.from(crypto.getRandomValues(new Uint32Array(3)), (value) => value.toString(16).padStart(8, '0')).join(''),
    title: title.trim(), kind, category, date, endDate,
    allDay: field('allDay').checked,
    start, end,
    linkId: kind === 'task' ? linkId : '',
    done: kind === 'task' && Boolean(previous?.done),
  });
  const validationError = validateEntry(entry);
  if (validationError) { showFormMessage(validationError); return; }
  const entries = previous ? data.entries.map((item) => {
    if (item.id === entry.id) return entry;
    return kind !== 'event' && item.linkId === entry.id ? { ...item, linkId: '' } : item;
  }) : [...data.entries, entry];
  if (!save({ ...data, entries })) {
    showFormMessage('浏览器未能保存这项安排，请检查存储设置。');
    return;
  }
  const changedDay = view.day !== date;
  view.day = date;
  if (view.tab === 'map') view.mapDate = date;
  editor.close();
  showView(view.tab, changedDay);
  highlightEntry(entry.id);
  announce(previous ? '已更新' : '已添加');
});

$('#delete-entry').addEventListener('click', () => {
  if (!editingId || !window.confirm('删除这项安排？')) return;
  const deleted = data.entries.find(({ id }) => id === editingId);
  const linkedIds = new Set(data.entries.filter(({ linkId }) => linkId === editingId).map(({ id }) => id));
  if (save({ ...data, entries: withoutEntries(new Set([editingId])) })) {
    editor.close();
    showView(view.tab, false);
    announce('已删除', {
      undo: () => {
        if (!deleted || data.entries.some(({ id }) => id === deleted.id)) return;
        const restored = data.entries.map((item) => linkedIds.has(item.id) && !item.linkId ? { ...item, linkId: deleted.id } : item);
        if (save({ ...data, entries: [...restored, deleted] })) {
          showView(view.tab, false);
          highlightEntry(deleted.id);
          announce('已恢复');
        }
      },
    });
  }
});

renderTheme();
showView('today');
