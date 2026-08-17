// Usage (from packages/nova_ecs, after `npm run build`):
//   node scripts/event_dispatch_benchmark.mjs
// Micro-benchmark: World.step with many systems and many no-listener
// component-change events (what entity.components.set emits per tick).
import { World } from '../dist/world.js';
import { Component } from '../dist/component.js';
import { System } from '../dist/system.js';
import { Entity } from '../dist/entity.js';
import { EcsEvent } from '../dist/events.js';

const world = new World('bench');
const comps = [];
for (let i = 0; i < 20; i++) comps.push(new Component(`C${i}`));
const events = [];
for (let i = 0; i < 10; i++) events.push(new EcsEvent(`E${i}`));
// 90 systems: 60 step systems over one component each, 30 event systems.
for (let i = 0; i < 60; i++) {
    world.addSystem(new System({ name: `S${i}`, args: [comps[i % comps.length]], step() { } }));
}
for (let i = 0; i < 30; i++) {
    world.addSystem(new System({ name: `EvS${i}`, events: [events[i % events.length]], args: [comps[i % comps.length]], step() { } }));
}
for (let e = 0; e < 300; e++) {
    const entity = new Entity(`e${e}`);
    for (let c = 0; c < comps.length; c++) entity.components.set(comps[c], { v: 0 });
    world.entities.set(`e${e}`, entity);
}
function tick() {
    // Rewrite every component of every entity (as MovementState etc. are per tick).
    for (const [, entity] of world.entities) {
        for (const c of comps) entity.components.set(c, { v: 1 });
    }
    world.step();
}
for (let i = 0; i < 100; i++) tick();
const N = 500;
const t0 = performance.now();
for (let i = 0; i < N; i++) tick();
console.log(`${((performance.now() - t0) / N).toFixed(3)} ms/tick (300 entities x 20 components rewritten, 90 systems)`);
