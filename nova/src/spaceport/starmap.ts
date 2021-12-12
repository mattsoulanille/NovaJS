import { SystemData } from "novadatainterface/SystemData";
import * as PIXI from 'pixi.js';
import { Observable } from "rxjs";
import { GameData } from "../client/gamedata/GameData";
import { ControlEvent } from "../nova_plugin/controls_plugin";
import { Button } from "./button";
import { Menu } from "./menu";
import { MenuControls } from "./menu_controls";


const GREY = 0x666666;
const BLUE = 0x0000BB;
const SYSTEM_TEXT = new PIXI.TextStyle({
    fontFamily: 'Geneva',
    fontSize: 10,
    align: 'left',
    fill: 0xffffff,
});

function drawSystem(system: SystemData, graphics: PIXI.Graphics, scale: number) {
    // Use blue if the system has a planet. Otherwise, grey.
    // TODO: Check if the planet is inhabited.
    const inhabited = system.planets.length > 0;
    const outColor = inhabited ? BLUE : GREY;
    const inColor = inhabited ? 0x000044 : 0x000000;
    graphics.lineStyle(1, outColor);
    graphics.beginFill(outColor)
    graphics.drawCircle(0, 0, 2.7 * scale);
    graphics.beginFill(inColor);
    graphics.drawCircle(0, 0, 1.8 * scale);
    graphics.endFill();
}

class SystemGraph {
    readonly container = new PIXI.Container();
    private readonly graphics: PIXI.Graphics;
    private readonly links: [SystemData, SystemData][];
    private readonly systems: Map<string, SystemData>;
    private scale = 2;
    private dragData?: {
        data: PIXI.InteractionData,
        offset: PIXI.Point,
    }
    private wrappedRoute: string[] = [];
    private routes: Map<string, string[]>;
    private systemCircles: Map<string, [PIXI.Container, PIXI.Graphics]>;
    private mapContainer: PIXI.Container;
    private maskedContainer: PIXI.Container;

    constructor(systems: SystemData[], private currentSystem: string,
        private size = { x: 456, y: 419 }) {
        this.systems = new Map(systems.map(s => [s.id, s]));
        this.routes = this.computeShortestPaths();

        this.graphics = new PIXI.Graphics();

        this.container.interactive = true;
        const onDragStart = this.onDragStart.bind(this);
        const onDragMove = this.onDragMove.bind(this);
        const onDragEnd = this.onDragEnd.bind(this);
        this.container.on('mousedown', onDragStart)
            .on('touchstart', onDragStart)
            .on('mouseup', onDragEnd)
            .on('mouseupoutside', onDragEnd)
            .on('touchend', onDragEnd)
            .on('touchendoutside', onDragEnd)
            .on('mousemove', onDragMove)
            .on('touchmove', onDragMove);

        this.mapContainer = new PIXI.Container();
        this.mapContainer.addChild(this.graphics);

        this.maskedContainer = new PIXI.Container();
        const mask = new PIXI.Graphics();
        mask.lineStyle(1);
        mask.beginFill(0xff0000);
        mask.drawRect(0, 0, size.x, size.y);
        this.maskedContainer.mask = mask;
        this.container.addChild(mask);

        this.maskedContainer.addChild(this.mapContainer);
        this.container.addChild(this.maskedContainer);

        this.links = [...this.getUniqueLinks()];

        this.systemCircles = new Map(systems.map(s => {
            const graphics = new PIXI.Graphics();
            drawSystem(s, graphics, this.scale);
            const container = new PIXI.Container();
            const circleContainer = new PIXI.Container();
            container.addChild(circleContainer);
            circleContainer.interactive = true;
            circleContainer.on('click', () => {
                this.onClickSystem(s.id);
            });
            circleContainer.addChild(graphics);

            const nameText = new PIXI.Text(s.name, SYSTEM_TEXT);
            nameText.position.x = 10;
            nameText.anchor.y = 0.5;
            container.addChild(nameText);

            this.mapContainer.addChild(container);
            return [s.id, [container, graphics]]
        }));

        this.draw();
    }

    center() {
        const system = this.systems.get(this.currentSystem);
        if (system) {
            const pos = this.scalePos(system.position);
            this.mapContainer.position.set(
                this.size.x / 2 - pos[0],
                this.size.y / 2 - pos[1]
            );
            this.updateTransform();
        }
    }

    set route(route: string[]) {
        this.wrappedRoute = route;
        this.draw();
    }

    get route() {
        return this.wrappedRoute;
    }

    draw(scale = this.scale) {
        this.mapContainer.cacheAsBitmap = false;
        this.scale = scale;
        this.graphics.clear();
        this.drawLinks();
        this.drawRoute();
        this.placeSystems();
        this.mapContainer.cacheAsBitmap = true;
    }

    private onDragStart(event: PIXI.InteractionEvent) {
        const dragPos = event.data.getLocalPosition(this.container);
        const offset = new PIXI.Point(
            this.mapContainer.position.x - dragPos.x,
            this.mapContainer.position.y - dragPos.y,
        );
        this.dragData = {
            data: event.data,
            offset
        }
    }

    private onDragMove() {
        if (this.dragData) {
            const dragPos = this.dragData.data.getLocalPosition(this.container);
            this.mapContainer.position.set(
                dragPos.x + this.dragData.offset.x,
                dragPos.y + this.dragData.offset.y,
            );
        }
    }

    private updateTransform() {
        // Since the map is cached as a bitmap, this updates the positions
        // of the system circles so they can be clicked again.
        this.mapContainer.containerUpdateTransform();
    }

    private onDragEnd() {
        this.dragData = undefined;
        this.updateTransform();
    }

    private onClickSystem(system: string) {
        this.route = this.routes.get(system) ?? [];
    }

    private getUniqueLinks() {
        const linksMap = new Map<string, [SystemData, SystemData]>();
        for (const [source, sourceSystem] of this.systems) {
            for (const dest of sourceSystem.links) {
                const linkEntry = [source, dest].sort().join('<->');
                if (this.systems.has(dest)) {
                    linksMap.set(linkEntry, [sourceSystem, this.systems.get(dest)!]);
                }
            }
        }
        return linksMap.values();
    }

    private placeSystems() {
        for (const [id, [container, graphics]] of this.systemCircles) {
            const system = this.systems.get(id);
            if (!system) {
                container.visible = false;
                console.warn(`missing system ${id}`);
                continue;
            }
            const pos = this.scalePos(system.position);
            graphics.clear();
            drawSystem(system, graphics, this.scale);
            container.position.set(...pos);
        }
    }

    private scalePos(pos: [number, number]): [number, number] {
        return pos.map(p => p * this.scale) as [number, number];
    }

    private drawLinks() {
        for (const [source, dest] of this.links) {
            this.drawLink(source, dest)
        }
    }

    private drawRoute() {
        let prev = this.systems.get(this.currentSystem);
        for (const system of this.route.map(id => this.systems.get(id))) {
            if (system) {
                if (prev) {
                    this.drawLink(prev, system, 0x00ff00, 3);
                }
                prev = system;
            }
        }
    }

    private drawLink(a: SystemData, b: SystemData,
        color = GREY, thickness = 1) {
        this.graphics.lineStyle(thickness, color);
        this.graphics.moveTo(...this.scalePos(a.position));
        this.graphics.lineTo(...this.scalePos(b.position));
    }

    private computeShortestPaths() {
        // Dijkstra's
        let frontier = new Set<string>([this.currentSystem]);
        const paths = new Map<string, string[]>([[this.currentSystem, []]]);

        while (true) {
            const newFrontier = new Set<string>();
            for (const id of frontier) {
                const system = this.systems.get(id);
                if (!system) {
                    continue;
                }

                const path = paths.get(id);
                if (!path) {
                    throw new Error(`Path to ${id} should exist`);
                }

                for (const link of system.links) {
                    if (paths.has(link)) {
                        continue;
                    }
                    newFrontier.add(link);
                    paths.set(link, [...path, link]);
                }
            }
            if (newFrontier.size === 0) {
                break;
            }
            frontier = newFrontier;
        }
        return paths;
    }
}

export class Starmap extends Menu<string[] /* route list of systems */> {
    private systemGraph?: SystemGraph;

    constructor(gameData: GameData, private systemId: string, controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8509", controlEvents);
        this.container.name = "StarMap";
        //this.container.alpha = 0.5;
        const buttons = {
            done: new Button(gameData, "Done", 120, { x: 150, y: 220 }),
        };
        this.addButtons(buttons);

        buttons.done.click.subscribe(this.done.bind(this));

        this.controls = new MenuControls(controlEvents, {
            // TODO: Bind tab to cycle destinations
            depart: this.done.bind(this),
            map: this.done.bind(this),
        });

    }
    async build() {
        await super.build();
        const systemIds = (await this.gameData.ids).System;
        const systems = await Promise.all(
            systemIds.map(s => this.gameData.data.System.get(s)));
        this.systemGraph = new SystemGraph(systems, this.systemId);
        this.systemGraph.container.position.set(-290, -248);
        this.container.addChild(this.systemGraph.container);
    }

    async show(route: string[]) {
        await this.buildPromise
        if (!this.systemGraph) {
            throw new Error('Expected system graph to be built')
        }
        this.systemGraph.center();
        this.systemGraph.route = route;
        return super.show(route);
    }

    done() {
        if (this.systemGraph) {
            this.input = this.systemGraph.route;
        }
        super.done();
    }
}
