/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
declare module 'bpmn-js/lib/NavigatedViewer' {
  const Viewer: new (options: { container: HTMLElement }) => unknown;
  export default Viewer;
}
