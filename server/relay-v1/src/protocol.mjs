// SPDX-License-Identifier: MIT
export const LIMIT = Object.freeze({ lease: 15000, frame: 2088, payload: 2048, listeners: 8, sockets: 10, framesPerSecond: 50, controlsPerSecond: 100, records: 4096 });
export const identifier = (s, max = 64) => typeof s === 'string' && s.length <= max && /^[A-Za-z0-9_-]+$/.test(s);
export function parseFrame(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 41 || data.byteLength > LIMIT.frame) throw new Error('frame bounds');
  const b = new Uint8Array(data), v = new DataView(data);
  if (b[0] !== 78 || b[1] !== 86 || b[2] !== 82 || b[3] !== 71 || b[4] !== 1 || b[5] !== 1 || b[6] !== 0 || b[7] !== 40) throw new Error('frame format');
  const deadline = Number(v.getBigUint64(16));
  if (!Number.isSafeInteger(deadline)) throw new Error('deadline format');
  const hex = [...b.slice(24, 40)].map(x => x.toString(16).padStart(2, '0')).join('');
  const grantId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  return { epoch: v.getUint32(8), sequence: v.getUint32(12), deadline, grantId };
}
