import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const directory = dirname(fileURLToPath(import.meta.url))
const iconPath = join(directory, '..', 'src', 'main', 'assets', 'app.ico')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const svg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect x="12" y="12" width="232" height="232" rx="60" fill="#10201e"/>
    <path d="M128 36 207 65v57c0 52-31 86-79 110-48-24-79-58-79-110V65z" fill="#5eead4"/>
    <path d="m128 77 43 101h-22l-8-21h-27l-8 21H85zm0 38-9 24h18z" fill="#0c0c0f"/>
  </svg>
`)

const frames = await Promise.all(sizes.map((size) =>
  sharp(svg).resize(size, size).png().toBuffer(),
))
const directoryEntriesSize = 6 + frames.length * 16
let imageOffset = directoryEntriesSize
const header = Buffer.alloc(directoryEntriesSize)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(frames.length, 4)

frames.forEach((frame, index) => {
  const entryOffset = 6 + index * 16
  const size = sizes[index]
  header.writeUInt8(size === 256 ? 0 : size, entryOffset)
  header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
  header.writeUInt8(0, entryOffset + 2)
  header.writeUInt8(0, entryOffset + 3)
  header.writeUInt16LE(1, entryOffset + 4)
  header.writeUInt16LE(32, entryOffset + 6)
  header.writeUInt32LE(frame.length, entryOffset + 8)
  header.writeUInt32LE(imageOffset, entryOffset + 12)
  imageOffset += frame.length
})

await writeFile(iconPath, Buffer.concat([header, ...frames]))
console.log(`Generated ${iconPath} with ${sizes.length} PNG icon sizes.`)
