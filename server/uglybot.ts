/**
 * Workers-safe re-export of the framework's typed `uglyBotRequest`. The workers
 * adapter entry exposes the runtime-neutral implementation without dragging the
 * Node server barrel into the Workers bundle, so chat code gets the fully-typed
 * op client (input + output inferred from the shared `proxyOps` registry).
 */
export { uglyBotRequest } from 'ugly-app/server/adapter/workers';
