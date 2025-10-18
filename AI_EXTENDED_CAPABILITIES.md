# AI Extended Capabilities - Summary

This document outlines all the new AI capabilities added to the collaborative canvas application.

## Viewport Control Functions

### 1. Get Viewport State
**Function:** `getViewport`
**Description:** Read the current viewport state including pan position and zoom level
**Returns:**
- `offsetX`, `offsetY`: Top-left corner of viewport in world coordinates
- `centerX`, `centerY`: Center of viewport in world coordinates
- `zoom`: Current zoom level (scale factor)
- `viewportWidth`, `viewportHeight`: Viewport dimensions in pixels

**Example commands:**
- "What's the current zoom level?"
- "Where am I looking on the canvas?"
- "What's my current viewport position?"

### 2. Set Zoom with Optional Focus
**Function:** `setZoom`
**Description:** Change the zoom level, optionally focusing on a specific world coordinate
**Parameters:**
- `zoomLevel`: Scale factor (0.1 to 5.0, where 1.0 = 100%)
- `focusX`, `focusY`: Optional world coordinates to keep centered while zooming

**Example commands:**
- "Zoom to 200%"
- "Zoom to 150% on BigCircle" (AI finds BigCircle coordinates, then zooms with focus)
- "Zoom in to 300% on coordinate 500, 500"
- "Set zoom to 50%"

### 3. Set Pan Position
**Function:** `setPan`
**Description:** Directly set the viewport offset (scroll position)
**Parameters:**
- `x`, `y`: Top-left corner offset in world coordinates

**Example commands:**
- "Set the scroll position to 1000, 2000"
- "Move the viewport offset to origin"

**Note:** For centering on a coordinate, use `panToCoordinate` instead, which is more intuitive.

## Shape Management Functions

### 4. Shape Creation
**Function:** `createShape`
**Description:** Create new shapes on the canvas with customizable properties
**Parameters:**
- `x`, `y`: Position in pixels (required)
- `width`, `height`: Size in pixels (required)
- `sides`: Number of sides - 0=circle, 3=triangle, 4=rectangle, 5+=polygon (optional, default: 4)
- `stroke`: Outline color in hex (optional, default: #000000)
- `fill`: Fill color in hex or null (optional, default: #ffffff)
- `text_md`: Text content (optional)
- `text_color`: Text color in hex (optional, default: #000000)

**Example commands:**
- "Create a blue circle at 500, 300 with 200px radius"
- "Add a red triangle at the origin"
- "Make a hexagon at 1000, 500"

### 5. Shape Deletion
**Function:** `deleteShapes`
**Description:** Remove one or more shapes from the canvas
**Parameters:**
- `shapeIds`: Array of shape IDs to delete

**Example commands:**
- "Delete the selected shapes"
- "Remove BigCircle"
- "Delete all triangles"

### 6. Shape Property Modal Control
**Function:** `toggleShapeModal`
**Description:** Open, close, or toggle the shape properties modal
**Parameters:**
- `action`: 'open', 'close', or 'toggle'
- `shapeId`: Shape ID (required for 'open' action)

**Example commands:**
- "Open the properties modal for BigCircle"
- "Show me the properties panel"
- "Close the modal"
- "Toggle the property editor"

### 7. Debug HUD Control
**Function:** `toggleDebugHUD`
**Description:** Show, hide, or toggle the debug heads-up display
**Parameters:**
- `action`: 'show', 'hide', or 'toggle'

**Example commands:**
- "Show the debug HUD"
- "Hide the debug overlay"
- "Toggle debug mode"
- "Turn on debug information"

### 8. Canvas Menu Control
**Function:** `toggleCanvasMenu`
**Description:** Show, hide, or toggle the canvas menu (export/versions)
**Parameters:**
- `action`: 'show', 'hide', or 'toggle'
- `tab`: 'export' or 'versions' (optional)

**Example commands:**
- "Open the canvas menu"
- "Show the export options"
- "Open the versions tab"
- "Close the menu"

### 9. Download PNG
**Function:** `downloadPNG`
**Description:** Export and download the canvas as a PNG image
**No parameters required**

**Example commands:**
- "Download this as PNG"
- "Export to PNG"
- "Save as image"

### 10. Download SVG
**Function:** `downloadSVG`
**Description:** Export and download the canvas as an SVG vector file
**No parameters required**

**Example commands:**
- "Download as SVG"
- "Export to vector format"
- "Save as SVG"

### 11. Download JSON
**Function:** `downloadJSON`
**Description:** Export and download the canvas state as JSON (for backup/restore)
**No parameters required**

**Example commands:**
- "Download the canvas data"
- "Export as JSON"
- "Save canvas state"

### 12. Save Version
**Function:** `saveVersion`
**Description:** Save the current canvas state as a new version snapshot
**No parameters required**

**Example commands:**
- "Save this version"
- "Create a snapshot"
- "Save the current state"

### 13. Restore Version
**Function:** `restoreVersion`
**Description:** Restore a previously saved canvas version
**Parameters:**
- `identifier`: Can be:
  - Version ID (UUID string)
  - Date/time substring (e.g., "2025-10-18", "14:30")
  - Index number: 0/"last" (most recent), 1/"penultimate" (second most recent)
  - Number of versions ago (e.g., 5 = fifth most recent)

**Example commands:**
- "Restore the last version"
- "Go back to the previous version"
- "Restore the penultimate version"
- "Load the version from 5 versions ago"
- "Restore the version from yesterday"

### 14. UI State Inspection
**Function:** `getUIState`
**Description:** Get current UI state including modal status, HUD visibility, and available versions
**No parameters required**

**Returns:**
- `shapeModalOpen`: Boolean
- `shapeModalShapeId`: String or null
- `debugHUDVisible`: Boolean
- `canvasMenuOpen`: Boolean
- `canvasMenuTab`: 'export' | 'versions'
- `availableVersions`: Array of version objects with id, created_at, created_by, email

**Example commands:**
- "What modals are open?"
- "Is the debug HUD visible?"
- "What versions are available?"

## Implementation Details

### Client-Side (CanvasViewport.tsx)
All AI functions are implemented as `useCallback` hooks with:
- **Optimistic updates** for instant UI feedback
- **Database persistence** via Supabase
- **Real-time broadcast** to all connected users
- **Error handling with rollback** for failed operations

### API Layer (route.ts)
The AI API route provides:
- **Multi-round function calling** - AI can inspect data, then make modifications
- **Parallel tool execution** - Multiple functions can be called simultaneously
- **Enriched context** - System prompt includes current UI state and capabilities
- **GPT-4o model** - For reliable complex function calling

### Client Execution (ChatBox.tsx)
The ChatBox component:
- Sends UI state along with canvas state to the API
- Executes all returned function calls locally
- Handles both synchronous and asynchronous operations
- Provides error logging for debugging

## New UI State Sharing

The AI now receives information about:
- Whether the shape properties modal is open (and for which shape)
- Whether the debug HUD is visible
- Whether the canvas menu is open (and which tab)
- All available saved versions with timestamps

This allows the AI to:
- Answer questions about current UI state
- Toggle UI elements contextually
- Suggest saving versions before major changes
- Reference specific versions intelligently

## Version Management Intelligence

The AI can understand natural language version references:
- **"last version"** → Most recent saved version
- **"penultimate version"** → Second most recent
- **"5 versions ago"** → Fifth most recent
- **"version from yesterday"** → Searches by date substring
- **"version at 2pm"** → Searches by time substring

## Multi-Step Workflow Example

User: "Create 3 circles in a row, then save this as a version"

AI workflow:
1. Calls `createShape` three times with calculated positions
2. Waits for confirmation
3. Calls `saveVersion`
4. Responds: "I've created 3 circles at positions X, Y, Z and saved the current canvas as a new version."

## Testing Commands

Here are some comprehensive commands to test all new functionality:

```
"Create a blue hexagon at 500, 500"
"Delete all selected shapes"
"Open the properties for BigCircle"
"Show the debug HUD"
"Hide the canvas menu"
"Download this as PNG"
"Save a version of this canvas"
"Restore the last version"
"What's the current UI state?"
"Create a red triangle, then export as SVG"
```

## Error Handling

All functions include robust error handling:
- Invalid shape IDs return helpful error messages
- Failed database operations trigger rollbacks
- Missing required parameters are caught and reported
- AI is informed of errors and can explain them to the user

## Performance Considerations

- **Optimistic UI updates** ensure instant feedback
- **Parallel function calls** reduce latency for multi-step operations
- **Efficient state queries** minimize unnecessary data transfer
- **Debounced broadcasts** prevent network flooding

---

**Total AI Functions:** 23+
- 5 Inspection functions (getCanvasJSON, getCurrentSelection, getAllUserCursors, getUIState, getViewport)
- 18+ Action functions (pan, zoom, create, delete, update, rename, annotate, select, toggle UI, export, version control)

**Viewport Control Features:**
- Read current zoom and pan position together
- Set zoom with optional focus point (zoom + pan in one operation)
- Direct pan/offset control for advanced use cases
- Intelligent zoom-to-shape capability (AI finds shape, then zooms to it)

