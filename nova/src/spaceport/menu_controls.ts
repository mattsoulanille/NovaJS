import { Observable, Subscription } from "rxjs";
import { ControlAction } from "../nova_plugin/controls";
import { ControlEvent } from "../nova_plugin/controls_plugin";

export class MenuControls {
    private controlsSubscription: Subscription | undefined;
    constructor(private controlEvents: Observable<ControlEvent>,
        private controls: { [index in ControlAction]?: () => void }) { }

    bind() {
        this.unbind();
        this.controlsSubscription =
            this.controlEvents.subscribe(({ action, state }) => {
                if (state === false) {
                    return;
                }
                this.controls[action]?.();
            });
    }

    unbind() {
        this.controlsSubscription?.unsubscribe();
        this.controlsSubscription = undefined;
    }
}
