import { categories, dayNumber, entryInterval } from '../schedule.js';

export const DAY_WIDTH = 160;
export const CARD_WIDTH = 164;
export const NODE_HEIGHT = 56;
const CHILD_HEIGHT = 48;
const GAP = 24;

function makeNode(entry, parentId = null) {
  const interval = entryInterval(entry);
  return { entry, parentId, day: interval.start, end: interval.end, width: Math.max(CARD_WIDTH, (interval.end - interval.start) * DAY_WIDTH), height: parentId ? CHILD_HEIGHT : NODE_HEIGHT, y: 0 };
}

// Pack complete event/task families rather than isolated cards. A family keeps
// its children below the event, while overlapping families get separate tracks.
export function layoutSchedule(entries, today) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const children = new Map();
  for (const entry of entries) {
    if (entry.kind !== 'task' || byId.get(entry.linkId)?.kind !== 'event') continue;
    if (!children.has(entry.linkId)) children.set(entry.linkId, []);
    children.get(entry.linkId).push(entry);
  }
  const roots = entries.filter((entry) => entry.kind !== 'task' || byId.get(entry.linkId)?.kind !== 'event');
  const nodes = [];
  const groups = [];
  const links = [];
  let y = 0;
  for (const category of categories) {
    const categoryRoots = roots.filter((entry) => entry.category === category);
    if (!categoryRoots.length && entries.length) continue;
    const bundles = categoryRoots.map((entry) => {
      const root = makeNode(entry);
      const childNodes = (children.get(entry.id) || []).map((child) => makeNode(child, entry.id)).sort((a, b) => a.day - b.day || a.entry.id.localeCompare(b.entry.id));
      const childTracks = [];
      for (const child of childNodes) {
        let lane = childTracks.findIndex((end) => child.day >= end + GAP / DAY_WIDTH);
        if (lane < 0) lane = childTracks.length;
        childTracks[lane] = child.day + child.width / DAY_WIDTH;
        child.y = NODE_HEIGHT + GAP + lane * (CHILD_HEIGHT + GAP);
      }
      const all = [root, ...childNodes];
      return {
        root, nodes: all,
        start: Math.min(...all.map((node) => node.day)),
        end: Math.max(...all.map((node) => node.day + node.width / DAY_WIDTH)),
        height: childTracks.length ? NODE_HEIGHT + GAP + childTracks.length * (CHILD_HEIGHT + GAP) - GAP : NODE_HEIGHT,
      };
    }).sort((a, b) => a.start - b.start || a.root.entry.id.localeCompare(b.root.entry.id));

    const tracks = [];
    for (const bundle of bundles) {
      let lane = tracks.findIndex((track) => bundle.start >= track.end + GAP / DAY_WIDTH);
      if (lane < 0) { lane = tracks.length; tracks.push({ end: -Infinity, height: 0 }); }
      tracks[lane].end = bundle.end;
      tracks[lane].height = Math.max(tracks[lane].height, bundle.height);
      bundle.lane = lane;
    }
    const groupY = y;
    y += 28;
    const trackY = tracks.map((track) => { const value = y; y += track.height + GAP; return value; });
    if (!tracks.length) y += 52;
    for (const bundle of bundles) {
      for (const node of bundle.nodes) {
        node.y += trackY[bundle.lane];
        nodes.push(node);
        if (node.parentId) links.push({ from: node.parentId, to: node.entry.id });
      }
    }
    groups.push({ category, y: groupY, height: y - groupY, nodes: bundles.flatMap((bundle) => bundle.nodes) });
    y += 20;
  }
  const current = dayNumber(today);
  const start = Math.min(current, ...nodes.map((node) => node.day));
  const end = Math.max(current + 1, ...nodes.map((node) => node.day + node.width / DAY_WIDTH));
  return { nodes, groups, links, height: Math.max(240, y), start: start - .25, end: Math.max(end + .25, start + 2) };
}
