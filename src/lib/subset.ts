// 以 HarfBuzz (WASM) 進行字型子集化。
// pdf-lib 內建的 fontkit 子集化會遺漏中文的複合字形（composite glyph），導致部分字無法顯示，
// 因此改為先用 HarfBuzz 產生只含所需字元的完整 TrueType，再以 subset:false 嵌入。

let instance: Promise<any> | null = null;

async function getExports(wasm?: BufferSource | (() => Promise<BufferSource>)) {
  if (!instance) {
    instance = (async () => {
      let bytes: BufferSource;
      if (typeof wasm === 'function') bytes = await wasm();
      else if (wasm) bytes = wasm;
      else {
        const url = (await import('harfbuzzjs/dist/harfbuzz-subset.wasm?url')).default;
        bytes = await (await fetch(url)).arrayBuffer();
      }
      const { instance: inst } = await WebAssembly.instantiate(bytes, {});
      (inst.exports as any)._initialize?.();
      return inst.exports;
    })();
    instance.catch(() => (instance = null));
  }
  return instance;
}

/** 回傳只包含 text 中字元的字型檔（TrueType） */
export async function subsetFont(font: Uint8Array, text: string, wasm?: BufferSource | (() => Promise<BufferSource>)): Promise<Uint8Array> {
  const ex = await getExports(wasm);
  const heap = () => new Uint8Array(ex.memory.buffer);
  const ptr = ex.malloc(font.byteLength);
  heap().set(font, ptr);
  const blob = ex.hb_blob_create(ptr, font.byteLength, 2 /* WRITABLE */, 0, 0);
  const face = ex.hb_face_create(blob, 0);
  ex.hb_blob_destroy(blob);
  const input = ex.hb_subset_input_create_or_fail();
  const set = ex.hb_subset_input_unicode_set(input);
  const cps = new Set<number>([0x20]);
  for (const ch of text) cps.add(ch.codePointAt(0)!);
  for (const cp of cps) ex.hb_set_add(set, cp);
  const sub = ex.hb_subset_or_fail(face, input);
  ex.hb_subset_input_destroy(input);
  if (!sub) {
    ex.free(ptr);
    throw new Error('字型子集化失敗');
  }
  const res = ex.hb_face_reference_blob(sub);
  const off = ex.hb_blob_get_data(res, 0);
  const len = ex.hb_blob_get_length(res);
  const out = heap().slice(off, off + len);
  ex.hb_blob_destroy(res);
  ex.hb_face_destroy?.(sub);
  ex.hb_face_destroy?.(face);
  ex.free(ptr);
  if (!len) throw new Error('字型子集化失敗');
  return out;
}
