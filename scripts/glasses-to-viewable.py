#!/usr/bin/env python3
"""Convert simulator glasses screenshots (content in ALPHA channel) to
viewable green-on-black PNGs. Usage: glasses-to-viewable.py in.png [out.png]"""
import sys, zlib, struct

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8; idat = b''; w = h = None; bitdepth = colortype = None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]
        data = d[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w, h, bitdepth, colortype = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        pos += 12 + ln
    raw = zlib.decompress(idat)
    assert colortype == 6, f'expected RGBA, got {colortype}'
    ch = 4; stride = w * ch
    out = bytearray(); prev = bytearray(stride); i = 0
    for _ in range(h):
        ft = raw[i]; i += 1
        row = bytearray(raw[i:i+stride]); i += stride
        if ft == 1:
            for x in range(ch, stride): row[x] = (row[x] + row[x-ch]) & 255
        elif ft == 2:
            for x in range(stride): row[x] = (row[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                a = row[x-ch] if x >= ch else 0
                row[x] = (row[x] + ((a + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = row[x-ch] if x >= ch else 0
                b = prev[x]; c = prev[x-ch] if x >= ch else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[x] = (row[x] + pr) & 255
        out += row; prev = row
    return w, h, out

def chunk(t, data):
    c = struct.pack('>I', len(data)) + t + data
    return c + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)

for src in sys.argv[1:]:
    w, h, px = read_png(src)
    # RGBA -> RGB green-on-black: (0, alpha, 0)
    rgb = bytearray()
    for j in range(0, len(px), 4):
        rgb += bytes((0, px[j+3], 0))
    raw = b''.join(b'\x00' + bytes(rgb[y*w*3:(y+1)*w*3]) for y in range(h))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw))
    png += chunk(b'IEND', b'')
    dst = src.replace('.png', '-view.png')
    open(dst, 'wb').write(png)
    print('wrote', dst)
