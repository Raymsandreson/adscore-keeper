import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

/**
 * localStorage no Node 22+ (aqui: v26).
 *
 * O Node passou a definir um `localStorage` global próprio (experimental), que
 * fica `undefined` quando o processo roda sem `--localstorage-file` — é a
 * origem do aviso "localStorage is not available because --localstorage-file
 * was not provided". Como a chave JÁ EXISTE em `globalThis`, o ambiente jsdom
 * do vitest não instala o dele por cima e o global fica undefined (só
 * `localStorage` colide; `sessionStorage` entra normalmente). Resultado: todo
 * teste que encostava em localStorage morria em "Cannot read properties of
 * undefined (reading 'clear')" — 11 deles, em BoardsList.view-mode e
 * UnifiedKanbanManager.board-param.
 *
 * O descriptor do Node é `configurable`, então dá para substituir por um
 * Storage de memória. Cada arquivo de teste roda isolado, então não há estado
 * vazando entre eles.
 */
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  const memoryStorage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => (store.has(String(key)) ? store.get(String(key))! : null),
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
  } as Storage;

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}

// Radix UI usa esses APIs ausentes no jsdom
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}

/**
 * PointerEvent não existe no jsdom. Sem ele, o fireEvent do Testing Library cai
 * num Event genérico e clientX/clientY/pointerId chegam NULOS ao handler — todo
 * teste de arrasto (o badge do cronômetro, por exemplo) media movimento zero e
 * passava mesmo com a posição travada. Herdar de MouseEvent devolve as
 * coordenadas; o resto é o mínimo que os handlers leem.
 */
if (!("PointerEvent" in window)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
      // movementX/Y não são preenchidos pelo MouseEvent do jsdom, e é por eles
      // que o arrasto decide se houve movimento (clique x drag).
      Object.defineProperty(this, "movementX", { value: init.movementX ?? 0 });
      Object.defineProperty(this, "movementY", { value: init.movementY ?? 0 });
    }
  }
  const descriptor = { value: PointerEventPolyfill, writable: true, configurable: true };
  Object.defineProperty(window, "PointerEvent", descriptor);
  Object.defineProperty(globalThis, "PointerEvent", descriptor);
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// crypto.randomUUID polyfill (jsdom geralmente já tem, mas garante)
if (!globalThis.crypto?.randomUUID) {
  (globalThis as any).crypto = (globalThis as any).crypto || {};
  (globalThis as any).crypto.randomUUID = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}
