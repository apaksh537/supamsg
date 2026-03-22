# SupaMsg v2 Build Checklist

## What's Being Built
Complete frontend rebuild of all 4 apps using approved Notion-style design (01e expanded panel).

## Architecture Changes
1. Desktop: index.html rewritten to match approved design
2. Desktop: Tool panels open as child BrowserWindows (not HTML overlays)
3. Desktop: BrowserView management cleaned up
4. Android: Design updated to match system
5. iOS: Design updated to match system
6. All: Comprehensive test cases

## Test Strategy
- Unit tests for each feature module
- Integration tests for IPC flows
- UI tests for every clickable element
- Cross-platform consistency checks
