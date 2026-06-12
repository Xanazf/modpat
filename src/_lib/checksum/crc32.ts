/** CRC-32 (IEEE 802.3 polynomial) over an array of 32-bit integers. */
export function crc32(arr: number[]): number {
  let crc = 0xffffffff;
  for (const v of arr) {
    let x = v >>> 0;
    for (let i = 0; i < 4; i++) {
      let byte = x & 0xff;
      for (let j = 0; j < 8; j++) {
        const bit = (crc ^ byte) & 1;
        crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
        byte >>>= 1;
      }
      x >>>= 8;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
