// next/headers on the canvas: no request, so no cookies or headers. Values are empty and
// writes do nothing; preview data comes from props and providers, never from a request.
const cookieStore = {
  get: (_name: string) => undefined,
  getAll: () => [],
  has: (_name: string) => false,
  set: (..._args: unknown[]) => {},
  delete: (..._args: unknown[]) => {},
  toString: () => "",
};
export const cookies = async () => cookieStore;
export const headers = async () => new Headers();
export const draftMode = async () => ({ isEnabled: false, enable: () => {}, disable: () => {} });
