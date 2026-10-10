/**
 * A test-only NBT decoder, written from the format specification rather than
 * from the exporter, so the exporter's output is checked by an independent
 * reader. Longs come back as bigint.
 */
import { gunzipSync } from 'node:zlib'

export type NbtValue = number | bigint | string | NbtValue[] | BigInt64Array | Int32Array | Int8Array | NbtCompound

export interface NbtCompound {
  [name: string]: NbtValue
}

export function readGzippedNbt(bytes: Uint8Array): { name: string; root: NbtCompound } {
  return readNbt(gunzipSync(bytes))
}

export function readNbt(bytes: Uint8Array): { name: string; root: NbtCompound } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0

  const u8 = () => view.getUint8(offset++)
  const i16 = () => {
    const value = view.getInt16(offset)
    offset += 2
    return value
  }
  const i32 = () => {
    const value = view.getInt32(offset)
    offset += 4
    return value
  }
  const i64 = () => {
    const value = view.getBigInt64(offset)
    offset += 8
    return value
  }
  const str = () => {
    const length = view.getUint16(offset)
    offset += 2
    const text = new TextDecoder().decode(bytes.subarray(offset, offset + length))
    offset += length
    return text
  }

  const payload = (type: number): NbtValue => {
    switch (type) {
      case 1: return view.getInt8(offset++)
      case 2: return i16()
      case 3: return i32()
      case 4: return i64()
      case 5: { const value = view.getFloat32(offset); offset += 4; return value }
      case 6: { const value = view.getFloat64(offset); offset += 8; return value }
      case 7: {
        const length = i32()
        const out = new Int8Array(bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length))
        offset += length
        return out
      }
      case 8: return str()
      case 9: {
        const elementType = u8()
        const length = i32()
        const items: NbtValue[] = []
        for (let index = 0; index < length; index++) items.push(payload(elementType))
        return items
      }
      case 10: {
        const out: NbtCompound = {}
        for (;;) {
          const childType = u8()
          if (childType === 0) return out
          const name = str()
          out[name] = payload(childType)
        }
      }
      case 11: {
        const length = i32()
        const out = new Int32Array(length)
        for (let index = 0; index < length; index++) out[index] = i32()
        return out
      }
      case 12: {
        const length = i32()
        const out = new BigInt64Array(length)
        for (let index = 0; index < length; index++) out[index] = i64()
        return out
      }
      default:
        throw new Error(`unknown NBT tag type ${type} at byte ${offset - 1}`)
    }
  }

  const rootType = u8()
  if (rootType !== 10) throw new Error(`root tag is type ${rootType}, not a compound`)
  const name = str()
  const root = payload(10) as NbtCompound
  if (offset !== bytes.length) throw new Error(`${bytes.length - offset} trailing bytes after the root tag`)
  return { name, root }
}

/**
 * Litematica's `LitematicaBitArray.getAt`: entries are packed little-end first
 * and may straddle two longs.
 */
export function litematicaEntry(longs: BigInt64Array, bits: number, index: number): number {
  const mask = (1n << BigInt(bits)) - 1n
  const startOffset = BigInt(index) * BigInt(bits)
  const start = Number(startOffset >> 6n)
  const end = Number(((BigInt(index) + 1n) * BigInt(bits) - 1n) >> 6n)
  const startBit = startOffset & 63n
  const word = (k: number) => BigInt.asUintN(64, longs[k]!)
  if (start === end) return Number((word(start) >> startBit) & mask)
  const endOffset = 64n - startBit
  return Number(((word(start) >> startBit) | (word(end) << endOffset)) & mask)
}
