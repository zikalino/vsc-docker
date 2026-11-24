// Load a panel wasm module and marshal across its C ABI.
//
// The ABI passes one `u64` per value — low 32 bits a pointer into the guest's linear memory, high 32
// a length — with UTF-8 JSON on the other side. The panel modules declare no imports, so this loader
// is deliberately small and free of Node or `vscode` references: it runs in a webview.

export interface Effects {
  repaint: boolean;
  cursor?: "default" | "pointer" | "text";
}

interface Exports {
  memory: WebAssembly.Memory;
  abi_version(): number;
  abi_alloc(len: number): number;
  abi_free(ptr: number, len: number): void;
  abi_frame(width: number, height: number): bigint;
  abi_input(ptr: number, len: number): bigint;
}

/** One instantiated panel module. */
export class WasmGuest {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  private constructor(private readonly wasm: Exports) {}

  /** Instantiate a module from its bytes. */
  static async load(bytes: ArrayBuffer): Promise<WasmGuest> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const wasm = instance.exports as unknown as Exports;
    if (typeof wasm.abi_version !== "function" || wasm.abi_version() !== 1) {
      throw new Error("the panel module speaks a different ABI version");
    }
    return new WasmGuest(wasm);
  }

  /** Feed one input event and return the module's effects. */
  input(event: unknown): Effects {
    const bytes = this.encoder.encode(JSON.stringify(event));
    const ptr = this.wasm.abi_alloc(bytes.length);
    if (ptr === 0 && bytes.length > 0) {
      return { repaint: false };
    }
    new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes);
    // `abi_input` consumes this buffer (the guest reconstructs and frees it), so we do not free it.
    const [outPtr, outLen] = unpack(this.wasm.abi_input(ptr, bytes.length));
    if (outPtr === 0 || outLen === 0) {
      return { repaint: false };
    }
    try {
      return JSON.parse(this.readAndFree(outPtr, outLen)) as Effects;
    } catch {
      return { repaint: false };
    }
  }

  /** Build one frame: the scene JSON, or `null` when the module produced nothing. */
  frame(width: number, height: number): string | null {
    const [ptr, len] = unpack(this.wasm.abi_frame(width, height));
    if (ptr === 0 || len === 0) {
      return null;
    }
    return this.readAndFree(ptr, len);
  }

  private readAndFree(ptr: number, len: number): string {
    const bytes = new Uint8Array(this.wasm.memory.buffer, ptr, len);
    const text = this.decoder.decode(bytes);
    this.wasm.abi_free(ptr, len);
    return text;
  }
}

function unpack(packed: bigint): [number, number] {
  const ptr = Number(packed & 0xffffffffn);
  const len = Number(packed >> 32n);
  return [ptr, len];
}
