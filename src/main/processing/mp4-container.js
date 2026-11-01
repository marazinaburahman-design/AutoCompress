import { ProcessingError } from './errors.js'

const containerTypes = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'dinf',
  'udta',
  'ilst',
  'tref',
])

export async function inspectMp4(handle, fileSize, { adjustOffsetsBy = 0 } = {}) {
  const boxes = []
  for (let offset = 0; offset < fileSize;) {
    if (boxes.length >= 10000) throw invalidVideo()
    const box = await readBox(handle, offset, fileSize)
    boxes.push(box)
    offset = box.end
  }
  const ftypCount = boxes.filter(({ type }) => type === 'ftyp').length
  const moovBoxes = boxes.filter(({ type }) => type === 'moov')
  const mediaBoxes = boxes.filter(({ type }) => type === 'mdat')
  if (
    ftypCount !== 1 ||
    moovBoxes.length !== 1 ||
    mediaBoxes.length < 1
  ) {
    throw invalidVideo()
  }
  const [moov] = moovBoxes
  const firstMediaIndex = boxes.findIndex(({ type }) => type === 'mdat')
  const moovIndex = boxes.indexOf(moov)
  const fragmented = boxes.some(({ type }) => type === 'moof')
  if (fragmented && moovIndex > firstMediaIndex) {
    throw new ProcessingError('UNSUPPORTED_VIDEO', 'Fragmented MP4 metadata must already precede its media data.')
  }
  const mediaRanges = mediaBoxes.map(({ payloadStart, end }) => ({ start: payloadStart, end }))
  const moovBuffer = await readBuffer(handle, moov.start, moov.size)
  const offsetState = { count: 0 }
  if (!fragmented) {
    updateChunkOffsets(moovBuffer, moov.headerSize, moovBuffer.length, adjustOffsetsBy, mediaRanges, offsetState, 0)
    if (offsetState.count === 0) throw invalidVideo()
  }
  return {
    boxes,
    moov,
    moovBuffer,
    mediaBoxes,
    firstMediaIndex,
    moovIndex,
    fragmented,
    shouldRelocate: moovIndex > firstMediaIndex,
  }
}

export async function readBox(handle, offset, containerEnd) {
  if (containerEnd - offset < 8) throw invalidVideo()
  const header = await readBuffer(handle, offset, Math.min(16, containerEnd - offset))
  const size32 = header.readUInt32BE(0)
  const type = header.toString('ascii', 4, 8)
  let headerSize = 8
  let size
  if (size32 === 1) {
    if (header.length < 16) throw invalidVideo()
    const extendedSize = header.readBigUInt64BE(8)
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidVideo()
    size = Number(extendedSize)
    headerSize = 16
  } else if (size32 === 0) {
    size = containerEnd - offset
  } else {
    size = size32
  }
  if (size < headerSize || size > containerEnd - offset) throw invalidVideo()
  return {
    start: offset,
    size,
    type,
    headerSize,
    payloadStart: offset + headerSize,
    end: offset + size,
  }
}

function updateChunkOffsets(buffer, start, end, delta, mediaRanges, state, depth) {
  if (depth > 16) throw invalidVideo()
  for (let offset = start; offset < end;) {
    const box = readBufferBox(buffer, offset, end)
    if (box.type === 'cmov' || box.type === 'mvex') throw invalidVideo()
    if (box.type === 'stco' || box.type === 'co64') {
      updateOffsetTable(buffer, box, delta, mediaRanges, state)
    } else if (containerTypes.has(box.type)) {
      updateChunkOffsets(buffer, box.payloadStart, box.end, delta, mediaRanges, state, depth + 1)
    } else if (box.type === 'meta') {
      if (box.payloadStart + 4 > box.end) throw invalidVideo()
      updateChunkOffsets(buffer, box.payloadStart + 4, box.end, delta, mediaRanges, state, depth + 1)
    }
    offset = box.end
  }
}

export function adjustChunkOffsets(buffer, start, end, delta, mediaRanges) {
  const state = { count: 0 }
  updateChunkOffsets(buffer, start, end, delta, mediaRanges, state, 0)
  if (state.count === 0) throw invalidVideo()
  return state.count
}

function readBufferBox(buffer, offset, containerEnd) {
  if (containerEnd - offset < 8) throw invalidVideo()
  const size32 = buffer.readUInt32BE(offset)
  const type = buffer.toString('ascii', offset + 4, offset + 8)
  let headerSize = 8
  let size
  if (size32 === 1) {
    if (containerEnd - offset < 16) throw invalidVideo()
    const extendedSize = buffer.readBigUInt64BE(offset + 8)
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidVideo()
    size = Number(extendedSize)
    headerSize = 16
  } else if (size32 === 0) {
    size = containerEnd - offset
  } else {
    size = size32
  }
  if (size < headerSize || size > containerEnd - offset) throw invalidVideo()
  return {
    type,
    headerSize,
    payloadStart: offset + headerSize,
    end: offset + size,
  }
}

function updateOffsetTable(buffer, box, delta, mediaRanges, state) {
  const payloadSize = box.end - box.payloadStart
  if (payloadSize < 8) throw invalidVideo()
  const entryCount = buffer.readUInt32BE(box.payloadStart + 4)
  const entrySize = box.type === 'stco' ? 4 : 8
  if (payloadSize !== 8 + entryCount * entrySize) throw invalidVideo()
  state.count += entryCount
  if (state.count > 1_000_000) throw invalidVideo()
  for (let index = 0; index < entryCount; index += 1) {
    const position = box.payloadStart + 8 + index * entrySize
    const original = entrySize === 4
      ? BigInt(buffer.readUInt32BE(position))
      : buffer.readBigUInt64BE(position)
    if (!mediaRanges.some(({ start, end }) => original >= BigInt(start) && original < BigInt(end))) {
      throw invalidVideo()
    }
    const updated = original + BigInt(delta)
    if (updated < 0n || (entrySize === 4 && updated > 0xffffffffn) || updated > 0xffffffffffffffffn) {
      throw invalidVideo()
    }
    if (entrySize === 4) buffer.writeUInt32BE(Number(updated), position)
    else buffer.writeBigUInt64BE(updated, position)
  }
}

async function readBuffer(handle, position, length) {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset)
    if (bytesRead === 0) throw invalidVideo()
    offset += bytesRead
  }
  return buffer
}

function invalidVideo() {
  return new ProcessingError('INVALID_VIDEO', 'The MP4 file is damaged or uses an unsupported container layout.')
}
