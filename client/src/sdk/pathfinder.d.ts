export interface PathfinderOptions {
  siteId: string;
  apiBaseUrl?: string;
  container?: HTMLElement;
}
export interface PathfinderInstance { destroy(): void }
export declare const Pathfinder: {
  readonly version: string;
  init(options: PathfinderOptions): PathfinderInstance;
};
