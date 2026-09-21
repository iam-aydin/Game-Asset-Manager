import type { IpcApi } from '@shared/types';

declare module '*.png' {
  const src: string;
  export default src;
}
declare global {
  interface Window {
    meshFlask: IpcApi;
  }
}

export { };
