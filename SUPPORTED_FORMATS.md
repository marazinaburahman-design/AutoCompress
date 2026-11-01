# Supported Formats

These capabilities come from the registered processors. Inputs are detected by file signature and container contents; renaming a file does not convert it.

| Input | Output | Status |
|---|---|---|
| PNG | PNG, JPEG, WebP, AVIF, TIFF | Supported |
| JPEG | PNG, JPEG, WebP, AVIF, TIFF | Supported |
| WebP | PNG, JPEG, WebP, AVIF, TIFF | Supported |
| AVIF | PNG, JPEG, WebP, AVIF, TIFF | Supported |
| TIFF | PNG, JPEG, WebP, AVIF, TIFF | Supported |
| BMP | PNG, JPEG, WebP, AVIF, TIFF | Supported |

Image conversion supports configurable quality and optional resize limits. BMP is input-only; BMP output is not implemented. Unsupported, corrupt, or mismatched files are rejected and reported.

| Input | Output | Status |
|---|---|---|
| ZIP | ZIP | Supported: streams entries into a new archive using maximum DEFLATE compression. Entry count and total uncompressed data are limited; encrypted archives and symbolic links are rejected. |
| PDF | PDF | Supported: parses and reserializes documents using object streams. Encrypted, empty, damaged, or oversized PDFs are rejected. |
| WAV (PCM 16-bit, mono/stereo) | WAV (PCM 16-bit, mono) | Supported: downmixes to mono and reduces sample rate to at most 22.05 kHz. |
| MP4 (non-fragmented, or already fast-start fragmented) | MP4 | Supported: moves non-fragmented movie metadata before media data and adjusts chunk offsets. Preserves encoded streams; does not transcode. |
| DOCX, XLSX, PPTX | Same format | Supported: validates required OOXML parts and namespaces, then losslessly recompresses the package. |

| Operation | Status |
|---|---|
| ZIP archive creation/extraction | Not implemented; ZIP processing currently recompresses existing archives without extracting them. |
| PDF editing, image downsampling, and other content changes | Not implemented; PDF processing preserves pages and metadata during reserialization. |
| Other audio formats or audio codecs | Not implemented |
| Video transcoding or fragmented MP4 metadata relocation | Not implemented |
| Office document conversion to another format | Not implemented |
