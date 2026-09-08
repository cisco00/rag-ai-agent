#!/usr/bin/env python3
"""Generate all Tauri-required icon files for Vantage AI.

Creates a simple gradient 'V' logo in all required sizes and formats.
Requires: pip install Pillow
"""

import os
import struct
import io

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Pillow not found. Installing...")
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont


def create_logo(size):
    """Create a simple Vantage AI logo at the given size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background: rounded rectangle with dark blue gradient feel
    # Draw a filled circle as background (simulates rounded icon)
    margin = int(size * 0.02)
    bg_box = [margin, margin, size - margin, size - margin]

    # Dark navy background
    draw.rounded_rectangle(bg_box, radius=int(size * 0.18), fill=(15, 23, 42, 255))

    # Draw "V" shape
    cx, cy = size // 2, size // 2
    v_top = int(size * 0.22)
    v_bottom = int(size * 0.78)
    v_left = int(size * 0.2)
    v_right = int(size * 0.8)
    v_mid_x = cx
    v_mid_y = v_bottom

    # Stroke width proportional to size
    stroke = max(int(size * 0.06), 2)

    # Left arm of V (blue)
    draw.line([(v_left, v_top), (v_mid_x, v_mid_y)], fill=(59, 130, 246, 255), width=stroke)

    # Right arm of V (cyan)
    draw.line([(v_right, v_top), (v_mid_x, v_mid_y)], fill=(6, 182, 212, 255), width=stroke)

    # Small dot at the bottom of V (accent)
    dot_r = max(int(size * 0.03), 2)
    draw.ellipse(
        [v_mid_x - dot_r, v_mid_y - dot_r, v_mid_x + dot_r, v_mid_y + dot_r],
        fill=(99, 220, 255, 255),
    )

    # Three small dots above V forming a "network" pattern
    dots = [
        (v_left + int(size * 0.05), v_top - int(size * 0.02)),
        (cx, v_top - int(size * 0.06)),
        (v_right - int(size * 0.05), v_top - int(size * 0.02)),
    ]
    small_r = max(int(size * 0.015), 1)
    for dx, dy in dots:
        draw.ellipse(
            [dx - small_r, dy - small_r, dx + small_r, dy + small_r],
            fill=(99, 220, 255, 180),
        )

    return img


def create_ico(images, output_path):
    """Create a .ico file from a list of PIL Images."""
    # ICO format: header + directory entries + image data
    num_images = len(images)

    # Prepare PNG data for each image
    png_data_list = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_data_list.append(buf.getvalue())

    # ICO header: reserved(2) + type(2) + count(2) = 6 bytes
    header = struct.pack("<HHH", 0, 1, num_images)

    # Calculate offsets
    dir_entry_size = 16
    data_offset = 6 + (dir_entry_size * num_images)

    directory = b""
    for i, img in enumerate(images):
        w = img.width if img.width < 256 else 0
        h = img.height if img.height < 256 else 0
        png_size = len(png_data_list[i])

        # ICONDIRENTRY: width, height, colors, reserved, planes, bpp, size, offset
        entry = struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, png_size, data_offset)
        directory += entry
        data_offset += png_size

    with open(output_path, "wb") as f:
        f.write(header)
        f.write(directory)
        for png_data in png_data_list:
            f.write(png_data)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, "src-tauri", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    # Required sizes for Tauri
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
    }

    print("Generating Vantage AI icons...")

    # Generate PNGs
    generated_images = {}
    for filename, size in sizes.items():
        img = create_logo(size)
        path = os.path.join(icons_dir, filename)
        img.save(path, "PNG")
        generated_images[size] = img
        print(f"  Created {filename} ({size}x{size})")

    # Generate .ico (Windows) - include multiple sizes
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_images = [create_logo(s) for s in ico_sizes]
    ico_path = os.path.join(icons_dir, "icon.ico")
    create_ico(ico_images, ico_path)
    print(f"  Created icon.ico ({len(ico_sizes)} sizes)")

    # Generate .icns placeholder (macOS) - just a renamed 256px PNG
    # Real .icns requires Apple's iconutil, but Tauri accepts PNG fallback
    icns_path = os.path.join(icons_dir, "icon.icns")
    # Create a minimal icns with the 256px image
    # For CI on non-macOS, we'll create a PNG and rename it
    # Tauri actually accepts a PNG file with .icns extension on non-macOS builds
    img_256 = create_logo(256)
    img_256.save(icns_path, "PNG")
    print(f"  Created icon.icns (256x256 PNG)")

    # Also create a 512px icon for high-DPI
    img_512 = create_logo(512)
    img_512.save(os.path.join(icons_dir, "icon.png"), "PNG")
    print(f"  Created icon.png (512x512)")

    print(f"\nAll icons saved to: {icons_dir}")


if __name__ == "__main__":
    main()
