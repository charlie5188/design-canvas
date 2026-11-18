// next/cache on the canvas: there is no server cache, so each call does nothing. A client
// component that imports a server action reaches these through it.
export const revalidatePath = (..._args: unknown[]) => {};
export const revalidateTag = (..._args: unknown[]) => {};
export const updateTag = (..._args: unknown[]) => {};
export const refresh = () => {};
export const unstable_noStore = () => {};
export const unstable_cacheLife = (..._args: unknown[]) => {};
export const unstable_cacheTag = (..._args: unknown[]) => {};
export const cacheLife = (..._args: unknown[]) => {};
export const cacheTag = (..._args: unknown[]) => {};
export const unstable_cache = <T>(fn: T) => fn;
