export interface Stateful<T> {
    getState(): T;
    setState(state: T): void;
}
