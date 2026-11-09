import { dateFromDay, dateKey, dayNumber, isDateKey, startOfWeek, timeLabel } from '../schedule.js';
import { DAY_WIDTH, layoutSchedule } from './layout.js';

const MIN_SCALE = .0000001;
const MAX_SCALE = 4;
const MIN_DAY = dayNumber('0001-01-01');
const MAX_DAY = dayNumber('9999-12-31');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const svgNS = 'http://www.w3.org/2000/svg';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svg(tag, attributes = {}) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export class ScheduleMap {
  constructor(panel, { onOpenEntry, onSelectDate, onDateChange }) {
    this.panel = panel;
    this.viewport = panel.querySelector('#schedule-map');
    this.onOpenEntry = onOpenEntry;
    this.onSelectDate = onSelectDate;
    this.onDateChange = onDateChange;
    this.layout = layoutSchedule([], dateKey());
    this.camera = null;
    this.fitted = true;
    this.pointers = new Map();
    this.buttons = new Map();
    this.frame = 0;
    this.background = svg('svg', { class: 'map-background', 'aria-hidden': 'true' });
    this.connectors = svg('svg', { class: 'map-connections', 'aria-hidden': 'true' });
    this.nodeLayer = element('div', 'map-nodes');
    this.labels = element('div', 'map-group-labels');
    this.axis = element('div', 'map-axis');
    this.axis.setAttribute('aria-label', '日期刻度');
    this.viewport.append(this.background, this.connectors, this.nodeLayer, this.labels, this.axis);
    this.zoomSlider = panel.querySelector('#map-zoom');
    this.zoomSlider.addEventListener('input', () => this.zoomTo(.125 * 32 ** (Number(this.zoomSlider.value) / 100)));
    panel.querySelector('#map-zoom-in').addEventListener('click', () => this.zoomBy(1.5));
    panel.querySelector('#map-zoom-out').addEventListener('click', () => this.zoomBy(1 / 1.5));
    panel.querySelector('#map-fit').addEventListener('click', () => this.fitAll());
    panel.querySelector('#map-today').addEventListener('click', () => this.focusDate(dateKey()));
    panel.querySelector('#map-date-picker').addEventListener('change', (event) => {
      if (isDateKey(event.target.value)) this.focusDate(event.target.value);
    });
    this.viewport.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    this.viewport.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.viewport.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.viewport.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.viewport.addEventListener('pointercancel', (event) => this.pointerUp(event, true));
    this.viewport.addEventListener('click', (event) => {
      const control = event.target.closest('button');
      if (!control) return;
      event.preventDefault();
      if (event.detail === 0) this.activate(control.dataset);
    });
    this.viewport.addEventListener('keydown', (event) => this.keyDown(event));
    this.observer = new ResizeObserver(() => {
      if (this.fitted && this.viewport.clientWidth) this.fitAll();
      else this.queueRender();
    });
    this.observer.observe(this.viewport);
  }

  geometry() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    const left = width < 500 ? 50 : 64;
    const top = 48;
    return { width, height, left, top, contentWidth: width - left, contentHeight: height - top };
  }

  verticalScale(scale, size = this.geometry()) {
    // A year-wide view should still distinguish themes and linked task rows.
    // Keep a readable overview height, bounded by the complete layout's fit.
    return Math.max(scale, Math.min(.65, size.contentHeight / this.layout.height * .92));
  }

  update(entries) {
    this.entries = entries;
    this.layout = layoutSchedule(entries, dateKey());
    if (!this.camera || this.fitted) this.fitAll();
    else this.queueRender();
  }

  fitAll() {
    const size = this.geometry();
    if (size.contentWidth <= 0 || size.contentHeight <= 0) return;
    this.camera = {
      day: (this.layout.start + this.layout.end) / 2,
      y: this.layout.height / 2,
      scale: clamp(Math.min((size.contentWidth - 24) / ((this.layout.end - this.layout.start) * DAY_WIDTH), size.contentHeight / this.layout.height) * .92, MIN_SCALE, 1.4),
    };
    this.fitted = true;
    this.queueRender();
  }

  focusDate(date) {
    if (!isDateKey(date)) return;
    if (!this.camera) this.fitAll();
    if (!this.camera) return;
    this.camera.day = dayNumber(date) + .5;
    this.camera.scale = Math.max(this.camera.scale, .4);
    this.fitted = false;
    this.onDateChange(date);
    this.queueRender();
  }

  focusEntry(id, open = false) {
    const node = this.layout.nodes.find(({ entry }) => entry.id === id);
    if (!node) return;
    if (open) { this.onOpenEntry(node.entry); return; }
    if (!this.camera) this.fitAll();
    this.camera.day = node.day + Math.min(node.width / DAY_WIDTH, 2) / 2;
    this.camera.y = node.y + node.height / 2;
    this.camera.scale = Math.max(this.camera.scale, .95);
    this.fitted = false;
    this.queueRender();
  }

  focusGroup(category) {
    const group = this.layout.groups.find((item) => item.category === category);
    if (!group) return;
    const size = this.geometry();
    const first = group.nodes.length ? Math.min(...group.nodes.map((node) => node.day)) : dayNumber(dateKey());
    const last = group.nodes.length ? Math.max(...group.nodes.map((node) => node.day + node.width / DAY_WIDTH)) : first + 3;
    this.camera = {
      day: (first + last) / 2,
      y: group.y + group.height / 2,
      scale: clamp(Math.min((size.contentWidth - 24) / ((last - first + .4) * DAY_WIDTH), size.contentHeight / (group.height + 32)) * .9, MIN_SCALE, 1.5),
    };
    this.fitted = false;
    this.queueRender();
  }

  zoomBy(factor, anchor) {
    if (!this.camera) return;
    this.zoomTo(this.camera.scale * factor, anchor);
  }

  zoomTo(scale, anchor) {
    if (!this.camera) return;
    const size = this.geometry();
    const point = anchor || { x: size.left + size.contentWidth / 2, y: size.top + size.contentHeight / 2 };
    const dx = point.x - size.left - size.contentWidth / 2;
    const dy = point.y - size.top - size.contentHeight / 2;
    const next = clamp(scale, MIN_SCALE, MAX_SCALE);
    const day = this.camera.day + dx / (DAY_WIDTH * this.camera.scale);
    const y = this.camera.y + dy / this.verticalScale(this.camera.scale, size);
    this.camera.day = day - dx / (DAY_WIDTH * next);
    this.camera.y = y - dy / this.verticalScale(next, size);
    this.camera.scale = next;
    this.fitted = false;
    this.queueRender();
  }

  pan(dx, dy) {
    if (!this.camera) return;
    this.camera.day -= dx / (DAY_WIDTH * this.camera.scale);
    this.camera.y -= dy / this.verticalScale(this.camera.scale);
    this.fitted = false;
    this.queueRender();
  }

  point(event) {
    const bounds = this.viewport.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  wheel(event) {
    if (!this.camera) return;
    event.preventDefault();
    const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.clientHeight : 1);
    if (event.shiftKey) this.pan(-(event.deltaX || amount), 0);
    else this.zoomBy(Math.exp(-clamp(amount, -160, 160) * .003), this.point(event));
  }

  pointerDown(event) {
    if (event.button !== 0) return;
    const point = this.point(event);
    this.pointers.set(event.pointerId, point);
    this.viewport.setPointerCapture(event.pointerId);
    if (this.pointers.size === 1) {
      this.origin = point;
      this.dragged = false;
      this.pressed = event.target.closest('button')?.dataset;
    } else {
      this.dragged = true;
      this.pressed = null;
    }
    this.viewport.focus({ preventScroll: true });
  }

  pointerMove(event) {
    if (!this.pointers.has(event.pointerId) || !this.camera) return;
    const previous = this.pointers.get(event.pointerId);
    const before = [...this.pointers.values()];
    const current = this.point(event);
    this.pointers.set(event.pointerId, current);
    if (this.pointers.size >= 2) {
      const after = [...this.pointers.values()];
      const distance = (points) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const center = (points) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const from = center(before);
      const to = center(after);
      this.zoomBy(distance(after) / Math.max(1, distance(before)), from);
      this.pan(to.x - from.x, to.y - from.y);
      this.dragged = true;
    } else if (this.dragged || Math.hypot(current.x - this.origin.x, current.y - this.origin.y) > 5) {
      this.pan(current.x - previous.x, current.y - previous.y);
      this.dragged = true;
    }
    if (this.dragged) this.viewport.classList.add('is-panning');
  }

  pointerUp(event, cancelled = false) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
    if (!this.pointers.size) {
      this.viewport.classList.remove('is-panning');
      if (!cancelled && !this.dragged && this.pressed) this.activate(this.pressed);
      this.pressed = null;
    } else {
      this.dragged = true;
      this.pressed = null;
    }
  }

  activate(data) {
    this.viewport.focus({ preventScroll: true });
    if (data.entryId) this.focusEntry(data.entryId, this.camera.scale >= .65);
    else if (data.group) this.focusGroup(data.group);
    else if (data.date) this.onSelectDate(data.date);
  }

  keyDown(event) {
    const moves = { ArrowLeft: [100, 0], ArrowRight: [-100, 0], ArrowUp: [0, 100], ArrowDown: [0, -100] };
    if (moves[event.key]) {
      event.preventDefault();
      this.viewport.focus({ preventScroll: true });
      this.pan(...moves[event.key]);
    } else if (['+', '=', '-', '0', 'Home'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0' || event.key === 'Home') this.fitAll();
      else this.zoomBy(event.key === '-' ? 1 / 1.5 : 1.5);
    }
  }

  queueRender() {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  ticks(first, last, pixelsPerDay) {
    const result = [];
    if (pixelsPerDay >= 28) {
      const step = pixelsPerDay < 54 ? 2 : 1;
      for (let day = Math.floor(first); day <= last && result.length < 300; day += step) result.push(day);
    } else if (pixelsPerDay >= 8) {
      for (let day = dayNumber(startOfWeek(dateFromDay(first))); day <= last && result.length < 300; day += 7) result.push(day);
    } else {
      const months = [1, 3, 6, 12, 24, 60, 120, 600, 1200].find((step) => step * 30 * pixelsPerDay >= 65) || 2400;
      const firstDate = new Date(Math.floor(first) * 86400000);
      let index = firstDate.getUTCFullYear() * 12 + firstDate.getUTCMonth();
      index -= ((index % months) + months) % months;
      for (let count = 0; count < 300; count++, index += months) {
        const year = Math.floor(index / 12);
        if (year < 1) continue;
        if (year > 9999) break;
        const day = dayNumber(`${String(year).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}-01`);
        if (day > last) break;
        result.push(day);
      }
    }
    return result;
  }

  render() {
    const size = this.geometry();
    if (!this.camera || size.contentWidth <= 0 || size.contentHeight <= 0) return;
    const camera = this.camera;
    camera.day = clamp(camera.day, MIN_DAY, MAX_DAY);
    const verticalScale = this.verticalScale(camera.scale, size);
    const verticalMargin = size.contentHeight / verticalScale / 2;
    camera.y = clamp(camera.y, -verticalMargin, this.layout.height + verticalMargin);
    const pixelsPerDay = DAY_WIDTH * camera.scale;
    const x = (day) => size.left + size.contentWidth / 2 + (day - camera.day) * pixelsPerDay;
    const y = (worldY) => size.top + size.contentHeight / 2 + (worldY - camera.y) * verticalScale;
    const first = Math.max(MIN_DAY, camera.day - size.contentWidth / (2 * pixelsPerDay));
    const last = Math.min(MAX_DAY, camera.day + size.contentWidth / (2 * pixelsPerDay));
    this.viewport.style.setProperty('--map-axis-width', `${size.left}px`);
    this.viewport.dataset.scale = String(camera.scale);
    this.viewport.dataset.verticalScale = String(verticalScale);
    this.viewport.dataset.centerDay = String(camera.day);
    this.viewport.dataset.centerY = String(camera.y);
    this.viewport.dataset.detail = camera.scale < .3 ? 'overview' : camera.scale < 1 ? 'compact' : 'detail';
    for (const layer of [this.background, this.connectors]) {
      layer.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
      layer.setAttribute('width', size.width);
      layer.setAttribute('height', size.height);
    }
    const background = document.createDocumentFragment();
    const groupLabels = document.createDocumentFragment();
    for (const group of this.layout.groups) {
      const top = y(group.y);
      const height = group.height * verticalScale;
      if (top + height < size.top || top > size.height) continue;
      background.append(svg('rect', { x: size.left, y: top, width: size.contentWidth, height, rx: Math.min(18, 18 * verticalScale), class: 'map-band' }));
      const label = element('button', 'map-topic-button', group.category);
      label.type = 'button';
      label.dataset.category = group.category;
      label.dataset.group = group.category;
      label.dataset.noRipple = 'true';
      label.setAttribute('aria-label', `放大查看${group.category}`);
      label.title = `放大查看${group.category}`;
      label.style.top = `${clamp(top + 4, size.top + 4, size.height - 44)}px`;
      groupLabels.append(label);
    }
    const axisLabels = document.createDocumentFragment();
    for (const day of this.ticks(first, last, pixelsPerDay)) {
      const left = x(day);
      background.append(svg('line', { x1: left, x2: left, y1: size.top, y2: size.height, class: 'map-grid-line' }));
      const date = dateFromDay(day);
      const [year, month, dateOfMonth] = date.split('-').map(Number);
      const label = element('button', 'map-date-tick', pixelsPerDay >= 8 ? `${month}/${dateOfMonth}` : pixelsPerDay >= 1.8 ? `${year}/${month}` : String(year));
      label.type = 'button';
      label.dataset.date = date;
      label.dataset.noRipple = 'true';
      label.setAttribute('aria-label', `查看${date}当天`);
      label.style.left = `${left}px`;
      axisLabels.append(label);
    }
    const currentX = x(dayNumber(dateKey()));
    if (currentX >= size.left && currentX <= size.width) background.append(svg('line', { x1: currentX, x2: currentX, y1: size.top, y2: size.height, class: 'map-today-line' }));
    this.background.replaceChildren(background);
    this.labels.replaceChildren(groupLabels);
    this.axis.replaceChildren(axisLabels);

    const visible = new Set();
    const positions = new Map();
    for (const node of this.layout.nodes) {
      const left = x(node.day);
      const top = y(node.y);
      const width = Math.max(18, node.width * camera.scale);
      const height = Math.max(3, node.height * verticalScale);
      positions.set(node.entry.id, { left, top, width, height });
      if (left + width < size.left || left > size.width || top + height < size.top || top > size.height) continue;
      visible.add(node.entry.id);
      let button = this.buttons.get(node.entry.id);
      if (!button) {
        button = element('button', 'map-node');
        button.type = 'button';
        button.dataset.entryId = node.entry.id;
        button.dataset.noRipple = 'true';
        const icon = element('span', 'map-node-icon');
        icon.setAttribute('aria-hidden', 'true');
        const copy = element('span', 'map-node-copy');
        copy.append(element('span', 'map-node-title'), element('span', 'map-node-time'));
        const duration = element('span', 'map-duration');
        duration.setAttribute('aria-hidden', 'true');
        button.append(icon, copy, duration);
        this.buttons.set(node.entry.id, button);
        this.nodeLayer.append(button);
      }
      button.className = `map-node ${node.entry.kind}${node.entry.done ? ' is-done' : ''}${node.parentId ? ' is-linked' : ''}`;
      button.dataset.category = node.entry.category;
      button.dataset.parentId = node.parentId || '';
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      button.style.width = `${width}px`;
      button.style.height = `${height}px`;
      button.querySelector('.map-node-icon').hidden = height < 18 || camera.scale >= .3 && camera.scale < .65;
      const kind = { event: '日程', task: node.entry.done ? '已完成待办' : '待办', notice: '仅知晓' }[node.entry.kind];
      const description = `${node.entry.title}，${kind}，${node.entry.date}，${timeLabel(node.entry)}${node.parentId ? '，关联待办' : ''}`;
      button.setAttribute('aria-label', `${camera.scale < .65 ? '放大查看' : '编辑'}${description}`);
      button.title = description;
      button.querySelector('.map-node-icon').textContent = node.entry.kind === 'notice' ? 'ⓘ' : node.entry.kind === 'task' ? node.entry.done ? '✓' : '□' : '▱';
      button.querySelector('.map-node-title').textContent = node.entry.title;
      button.querySelector('.map-node-time').textContent = timeLabel(node.entry);
      button.querySelector('.map-duration').style.width = `${Math.min(width, Math.max(4, (node.end - node.day) * pixelsPerDay))}px`;
    }
    for (const [id, button] of this.buttons) {
      if (!visible.has(id)) { button.remove(); this.buttons.delete(id); }
    }
    const paths = document.createDocumentFragment();
    for (const link of this.layout.links) {
      const from = positions.get(link.from);
      const to = positions.get(link.to);
      if (!from || !to) continue;
      if (Math.max(from.left + from.width, to.left + to.width) < size.left || Math.min(from.left, to.left) > size.width || Math.min(from.top, to.top) > size.height || Math.max(from.top + from.height, to.top + to.height) < size.top) continue;
      const x1 = from.left + Math.min(from.width / 2, 50);
      const y1 = from.top + from.height;
      const x2 = to.left + Math.min(to.width / 2, 50);
      const y2 = to.top;
      const middle = (y1 + y2) / 2;
      paths.append(svg('path', { d: `M${x1} ${y1} C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`, class: 'map-link', 'data-from': link.from, 'data-to': link.to }));
    }
    this.connectors.replaceChildren(paths);
    const centerDate = dateFromDay(clamp(Math.floor(camera.day), MIN_DAY, MAX_DAY));
    this.panel.querySelector('#map-date-picker').value = centerDate;
    this.panel.querySelector('#map-date-caption').textContent = centerDate.replaceAll('-', '/');
    this.panel.querySelector('#map-range').textContent = `${dateFromDay(first).replaceAll('-', '/')} — ${dateFromDay(last).replaceAll('-', '/')}`;
    const percent = camera.scale < .01 ? '<1%' : `${Math.round(camera.scale * 100)}%`;
    this.panel.querySelector('#map-zoom-value').textContent = percent;
    this.zoomSlider.value = clamp(Math.log2(camera.scale / .125) / 5 * 100, 0, 100);
    this.zoomSlider.setAttribute('aria-valuetext', `缩放 ${percent}`);
    this.panel.querySelector('#map-zoom-in').disabled = camera.scale >= MAX_SCALE;
    this.panel.querySelector('#map-zoom-out').disabled = camera.scale <= MIN_SCALE;
  }
}
