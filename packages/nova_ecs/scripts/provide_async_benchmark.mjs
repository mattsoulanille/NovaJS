// Usage (from packages/nova_ecs, after `npm run build`):
//   node scripts/provide_async_benchmark.mjs
// Micro-benchmark: per-step cost of a ProvideAsync provider once every
// entity already has its provided component (the display world's
// AnimationGraphicLoader is one of these, over every drawn entity, every
// frame).
import { World } from '../dist/world.js';
import { Component } from '../dist/component.js';
import { Entity } from '../dist/entity.js';
import { ProvideAsync, ProvideAsyncPlugin } from '../dist/provide_async.js';
import { AsyncSystemPlugin, AsyncSystemResource } from '../dist/async_system.js';

const world = new World('bench');
await world.addPlugin(AsyncSystemPlugin);
await world.addPlugin(ProvideAsyncPlugin);
const Source = new Component('Source');
const Provided = new Component('Provided');
world.addSystem(ProvideAsync({
    name: 'Provider',
    provided: Provided,
    args: [Source],
    async factory(source) { return { built: source.id }; },
}));
for (let e = 0; e < 300; e++) {
    const entity = new Entity(`e${e}`);
    entity.components.set(Source, { id: e, images: { a: 1, b: 2 }, list: [1, 2, 3] });
    world.entities.set(`e${e}`, entity);
}
world.step();
await world.resources.get(AsyncSystemResource).done;
world.step();
await world.resources.get(AsyncSystemResource).done;
let provided = 0;
for (const [, entity] of world.entities) if (entity.components.has(Provided)) provided++;
// One step per macrotask, like a frame: the async system's promise
// chains must settle between steps or every step after the first is an
// exclusive-run early return.
const done = world.resources.get(AsyncSystemResource);
async function frame() {
    world.step();
    await done.done;
}
for (let i = 0; i < 100; i++) await frame();
const N = 1000;
const t0 = performance.now();
for (let i = 0; i < N; i++) await frame();
console.log(`${((performance.now() - t0) / N).toFixed(3)} ms/step (300 entities, ${provided} provided)`);
