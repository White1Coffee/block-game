import { WorldGenerator } from "./WorldGenerator";
const worker = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (data: unknown, transfer: Transferable[]) => void;
};
worker.onmessage = ({ data }) => {
  const generator = new WorldGenerator(data.seed, data.height, data.version);
  const blocks = generator.generate(data.cx, data.cz);
  worker.postMessage({ key: data.key, blocks }, [blocks.buffer]);
};
