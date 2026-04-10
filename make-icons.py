#!/usr/bin/env python3
"""Generate apple icon PNGs using pure Python (no external dependencies)."""

import struct
import zlib
import math

def make_png(pixels, width, height):
    """pixels: list of (r,g,b,a) tuples, row by row."""
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw_rows = []
    for y in range(height):
        row = b'\x00'  # filter type None
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            row += struct.pack('BBBB', r, g, b, a)
        raw_rows.append(row)

    compressed = zlib.compress(b''.join(raw_rows), 9)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

def lerp(a, b, t):
    return a + (b - a) * t

def dist(x1, y1, x2, y2):
    return math.sqrt((x2-x1)**2 + (y2-y1)**2)

def draw_icon(size):
    pixels = []
    cx = size / 2.0
    cy = size / 2.0 + size * 0.06  # apple body center slightly below middle

    for y in range(size):
        for x in range(size):
            nx = (x - cx) / (size * 0.42)   # normalized x
            ny = (y - cy) / (size * 0.40)   # normalized y

            r, g, b, a = 0, 0, 0, 0

            # --- stem ---
            stem_x = cx + size * 0.05
            stem_top = cy - size * 0.44
            stem_bot = cy - size * 0.30
            if stem_top <= y <= stem_bot and abs(x - stem_x) < size * 0.045:
                alpha = 1.0 - max(0, abs(x - stem_x) - size * 0.025) / (size * 0.02)
                alpha = max(0, min(1, alpha))
                r, g, b, a = 101, 67, 33, int(255 * alpha)

            # --- leaf ---
            # Small green leaf to the right of stem
            leaf_cx = stem_x + size * 0.13
            leaf_cy = stem_bot - size * 0.04
            lx = (x - leaf_cx) / (size * 0.14)
            ly = (y - leaf_cy) / (size * 0.085)
            # Rotated ellipse for leaf
            angle = -0.5
            lxr = lx * math.cos(angle) - ly * math.sin(angle)
            lyr = lx * math.sin(angle) + ly * math.cos(angle)
            if lxr*lxr + lyr*lyr*4 < 1.0:
                edge = math.sqrt(lxr*lxr + lyr*lyr*4)
                alpha = max(0, min(1, (1.0 - edge) * 3))
                r2 = int(lerp(80, 50, edge))
                g2 = int(lerp(180, 140, edge))
                b2 = int(lerp(60, 30, edge))
                r, g, b, a = r2, g2, b2, int(255 * alpha)

            # --- apple body ---
            # Apple shape: basically a rounded shape with a dent at the top center
            # Use superellipse + dent
            # The dent: reduce radius at the top center
            angle_to_top = math.atan2(-(y - cy), x - cx)  # angle from center
            # Dent factor: creates the characteristic apple top notch
            dent = 0.0
            if ny < 0:  # upper half
                dent_angle = math.atan2(-ny, nx)
                # Dent is centered at angle ~pi/2 (straight up)
                dent = 0.18 * math.exp(-((dent_angle - math.pi/2)**2) / 0.15)

            # Basic distance from center
            d = math.sqrt(nx*nx + ny*ny)
            # Apple is slightly wider than tall
            stretch_x = 1.0 + 0.08 * math.sin(math.atan2(ny, nx) * 2)
            effective_nx = nx * (1.0 + stretch_x * 0.05)
            d_shaped = math.sqrt(effective_nx**2 + (ny * 1.05)**2)

            threshold = 1.0 - dent
            if d_shaped < threshold:
                # Depth from edge for shading
                edge_dist = threshold - d_shaped

                # Base red color - bright apple red
                base_r, base_g, base_b = 220, 38, 38

                # Highlight: upper-left area gets lighter
                highlight = max(0, -nx * 0.5 - ny * 0.5)
                hr = int(min(255, base_r + highlight * 100))
                hg = int(min(255, base_g + highlight * 60))
                hb = int(min(255, base_b + highlight * 40))

                # Shadow: lower-right gets darker
                shadow = max(0, nx * 0.3 + ny * 0.4)
                sr = int(max(0, hr - shadow * 80))
                sg = int(max(0, hg - shadow * 30))
                sb = int(max(0, hb - shadow * 20))

                # Smooth edge anti-aliasing
                alpha = min(1.0, edge_dist / (0.05 * threshold) * size / 16)
                alpha = max(0, min(1, alpha))

                r, g, b, a = sr, sg, sb, int(255 * alpha)

            pixels.append((r, g, b, a))

    return pixels

def save_icon(size, path):
    pixels = draw_icon(size)
    png_data = make_png(pixels, size, size)
    with open(path, 'wb') as f:
        f.write(png_data)
    print(f'Saved {path} ({size}x{size})')

save_icon(32, 'chrome-extension/icons/icon32.png')
save_icon(128, 'chrome-extension/icons/icon128.png')
