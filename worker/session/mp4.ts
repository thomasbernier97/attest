// Frame size of a segment MP4, read from the first track header (tkhd) with a non-zero width.
// Segments carry one video track and no audio.

function readBoxes(view: DataView, start: number, end: number, visit: (type: string, start: number, size: number) => boolean): boolean {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return false;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return false;
    if (visit(type, offset + header, size - header)) return true;
    offset += size;
  }
  return false;
}

export function mp4FrameSize(bytes: ArrayBuffer): { width: number; height: number } | null {
  const view = new DataView(bytes);
  let found: { width: number; height: number } | null = null;
  const containers = new Set(["moov", "trak"]);
  const walk = (start: number, end: number): boolean =>
    readBoxes(view, start, end, (type, body, size) => {
      if (containers.has(type)) return walk(body, body + size);
      if (type !== "tkhd") return false;
      const version = view.getUint8(body);
      // Width and height are 16.16 fixed point after the version-dependent fields and the matrix.
      const at = body + (version === 1 ? 88 : 76);
      if (at + 8 > body + size) return false;
      const width = Math.round(view.getUint32(at) / 65536);
      const height = Math.round(view.getUint32(at + 4) / 65536);
      if (width === 0 || height === 0) return false;
      found = { width, height };
      return true;
    });
  walk(0, bytes.byteLength);
  return found;
}
