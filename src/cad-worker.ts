/// <reference lib="webworker" />
import initOpenCascade from "replicad-opencascadejs/src/replicad_single.js";
import wasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import * as replicad from "replicad";

let readyPromise: Promise<void> | null = null;

// emscripten の factory は Module オーバーライドを受け取るが、.d.ts は引数なしになっている
const initOC = initOpenCascade as unknown as (opts: {
  locateFile: () => string;
}) => Promise<unknown>;

function init(): Promise<void> {
  if (!readyPromise) {
    readyPromise = initOC({
      locateFile: () => wasmUrl,
    }).then((oc: unknown) => {
      replicad.setOC(oc as Parameters<typeof replicad.setOC>[0]);
      postMessage({ type: "ready" });
    });
  }
  return readyPromise;
}

init();

function buildShapes(code: string): {
  shapes: replicad.Shape3D[];
  ids: (string | null)[];
} {
  const rawShapes: (replicad.Shape3D | null)[] = [];
  const rawIds: (string | undefined)[] = [];
  const fn = new Function("replicad", "shapes", "shapeIds", code);
  fn(replicad, rawShapes, rawIds);
  const shapes: replicad.Shape3D[] = [];
  const ids: (string | null)[] = [];
  rawShapes.forEach((s, i) => {
    if (s != null) {
      shapes.push(s);
      ids.push(rawIds[i] ?? null);
    }
  });
  return { shapes, ids };
}

self.onmessage = async (event: MessageEvent) => {
  const { id, type, code } = event.data;
  try {
    await init();
    if (type === "run") {
      const started = performance.now();
      const { shapes, ids } = buildShapes(code);
      const meshes = shapes.map((shape, i) => ({
        name: `shape-${i}`,
        blockId: ids[i],
        faces: shape.mesh({ tolerance: 0.05, angularTolerance: 30 }),
        edges: shape.meshEdges(),
      }));
      const elapsedMs = performance.now() - started;
      postMessage({ id, type: "result", meshes, elapsedMs });
    } else if (type === "export-stl" || type === "export-step") {
      const { shapes } = buildShapes(code);
      if (shapes.length === 0) throw new Error("表示する形状がありません");
      let merged = shapes[0];
      for (const s of shapes.slice(1)) {
        merged = merged.fuse(s as replicad.Shape3D & replicad.AnyShape);
      }
      const blob =
        type === "export-stl" ? merged.blobSTL() : merged.blobSTEP();
      postMessage({ id, type: "export", blob });
    }
  } catch (error) {
    postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
