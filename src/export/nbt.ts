/**
 * A minimal NBT writer: the tags Litematica's schematic format uses, encoded
 * big-endian as Minecraft's `NbtIo` expects. Pure; no browser or Node APIs.
 */

export type NbtTag =
  | { type: 'byte'; value: number }
  | { type: 'int'; value: number }
  | { type: 'long'; value: bigint }
  | { type: 'string'; value: string }
  | { type: 'list'; elementType: NbtTagType; items: NbtTag[] }
  | { type: 'compound'; entries: Record<string, NbtTag> }
  | { type: 'longArray'; value: BigInt64Array }

export type NbtTagType = NbtTag['type'] | 'end'

const TAG_IDS: Readonly<Record<NbtTagType, number>> = {
  end: 0,
  byte: 1,
  int: 3,
  long: 4,
  string: 8,
  list: 9,
  compound: 10,
  longArray: 12,
}

export const nbt = {
  byte: (value: number): NbtTag => ({ type: 'byte', value }),
  int: (value: number): NbtTag => ({ type: 'int', value }),
  long: (value: bigint): NbtTag => ({ type: 'long', value }),
  string: (value: string): NbtTag => ({ type: 'string', value }),
  compound: (entries: Record<string, NbtTag>): NbtTag => ({ type: 'compound', entries }),
  longArray: (value: BigInt64Array): NbtTag => ({ type: 'longArray', value }),
  /** An empty list carries the `end` element type, as the game writes it. */
  list: (items: NbtTag[]): NbtTag => ({ type: 'list', elementType: items[0]?.type ?? 'end', items }),
}

/** Encode a named root compound. Litematica and the game name the root `""`. */
export function encodeNbt(root: NbtTag, name = ''): Uint8Array<ArrayBuffer> {
  if (root.type !== 'compound') throw new Error('an NBT root must be a compound')
  const out = new ByteWriter()
  out.u8(TAG_IDS.compound)
  out.string(name)
  writePayload(out, root)
  return out.bytes()
}

function writePayload(out: ByteWriter, tag: NbtTag): void {
  switch (tag.type) {
    case 'byte':
      out.i8(tag.value)
      return
    case 'int':
      out.i32(tag.value)
      return
    case 'long':
      out.i64(tag.value)
      return
    case 'string':
      out.string(tag.value)
      return
    case 'list':
      out.u8(TAG_IDS[tag.elementType])
      out.i32(tag.items.length)
      for (const item of tag.items) {
        if (item.type !== tag.elementType) throw new Error(`a ${tag.elementType} list cannot hold a ${item.type}`)
        writePayload(out, item)
      }
      return
    case 'compound':
      for (const [name, child] of Object.entries(tag.entries)) {
        out.u8(TAG_IDS[child.type])
        out.string(name)
        writePayload(out, child)
      }
      out.u8(TAG_IDS.end)
      return
    case 'longArray':
      out.i32(tag.value.length)
      for (const value of tag.value) out.i64(value)
      return
  }
}

class ByteWriter {
  private buffer: Uint8Array<ArrayBuffer> = new Uint8Array(1024)
  private view = new DataView(this.buffer.buffer)
  private length = 0

  bytes(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.length)
  }

  u8(value: number): void {
    this.reserve(1)
    this.view.setUint8(this.length++, value)
  }

  i8(value: number): void {
    this.reserve(1)
    this.view.setInt8(this.length++, value)
  }

  i32(value: number): void {
    this.reserve(4)
    this.view.setInt32(this.length, value)
    this.length += 4
  }

  i64(value: bigint): void {
    this.reserve(8)
    this.view.setBigInt64(this.length, value)
    this.length += 8
  }

  /** Java's modified UTF-8, with an unsigned 16-bit byte length in front. */
  string(value: string): void {
    const encoded = modifiedUtf8(value)
    if (encoded.length > 0xffff) throw new Error('an NBT string is limited to 65535 bytes')
    this.reserve(2 + encoded.length)
    this.view.setUint16(this.length, encoded.length)
    this.buffer.set(encoded, this.length + 2)
    this.length += 2 + encoded.length
  }

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return
    let capacity = this.buffer.length * 2
    while (capacity < this.length + extra) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(this.buffer.subarray(0, this.length))
    this.buffer = grown
    this.view = new DataView(grown.buffer)
  }
}

/**
 * Modified UTF-8 encodes each UTF-16 code unit on its own, so a character
 * outside the BMP becomes two 3-byte surrogates, and U+0000 takes two bytes.
 */
function modifiedUtf8(value: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0x01 && unit <= 0x7f) {
      bytes.push(unit)
    } else if (unit <= 0x7ff) {
      bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f))
    } else {
      bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f))
    }
  }
  return Uint8Array.from(bytes)
}
