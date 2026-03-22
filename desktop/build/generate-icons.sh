#!/bin/bash
# generate-icons.sh — Convert a PNG icon to .icns (macOS) and .ico (Windows)
#
# Prerequisites:
#   1. You need a 1024x1024 PNG file. You can convert the SVG to PNG first:
#      - Using Chrome: open icon.svg, screenshot at 1024x1024
#      - Using Inkscape: inkscape -w 1024 -h 1024 icon.svg -o icon.png
#      - Using librsvg: rsvg-convert -w 1024 -h 1024 icon.svg > icon.png
#      - Using ImageMagick: convert icon.svg -resize 1024x1024 icon.png
#
#   2. For .ico generation (Windows), you need ImageMagick:
#      brew install imagemagick
#
# Usage:
#   cd /Users/apakshgupta/projects/whatsapp-hub/build
#   ./generate-icons.sh icon.png

set -e

INPUT_PNG="${1:-icon.png}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$SCRIPT_DIR/$INPUT_PNG" ]; then
    echo "Error: $SCRIPT_DIR/$INPUT_PNG not found."
    echo "Please provide a 1024x1024 PNG file."
    echo ""
    echo "To convert the SVG to PNG first, run one of:"
    echo "  rsvg-convert -w 1024 -h 1024 icon.svg > icon.png"
    echo "  inkscape -w 1024 -h 1024 icon.svg -o icon.png"
    exit 1
fi

echo "==> Generating .icns for macOS..."

# Create temporary iconset directory
ICONSET_DIR="$SCRIPT_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

# Generate all required sizes using sips (built-in macOS tool)
sips -z 16 16     "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_16x16.png"      > /dev/null
sips -z 32 32     "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png"   > /dev/null
sips -z 32 32     "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_32x32.png"      > /dev/null
sips -z 64 64     "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png"   > /dev/null
sips -z 128 128   "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_128x128.png"    > /dev/null
sips -z 256 256   "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null
sips -z 256 256   "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_256x256.png"    > /dev/null
sips -z 512 512   "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null
sips -z 512 512   "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_512x512.png"    > /dev/null
sips -z 1024 1024 "$SCRIPT_DIR/$INPUT_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null

# Convert iconset to .icns using iconutil (built-in macOS tool)
iconutil -c icns "$ICONSET_DIR" -o "$SCRIPT_DIR/icon.icns"

# Clean up iconset directory
rm -rf "$ICONSET_DIR"

echo "    Created: $SCRIPT_DIR/icon.icns"

# Generate .ico for Windows (requires ImageMagick)
if command -v convert &> /dev/null; then
    echo "==> Generating .ico for Windows..."
    convert "$SCRIPT_DIR/$INPUT_PNG" \
        -define icon:auto-resize=256,128,64,48,32,16 \
        "$SCRIPT_DIR/icon.ico"
    echo "    Created: $SCRIPT_DIR/icon.ico"
else
    echo ""
    echo "Note: ImageMagick not found. Skipping .ico generation."
    echo "To generate icon.ico for Windows builds, install ImageMagick:"
    echo "  brew install imagemagick"
    echo "Then re-run this script."
fi

echo ""
echo "Done! Icon files are ready in $SCRIPT_DIR/"
