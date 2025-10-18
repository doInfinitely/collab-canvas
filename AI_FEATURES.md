# AI Canvas Assistant Features

## Overview
The AI Canvas Assistant is an AI-powered chatbox that allows users to interact with the collaborative canvas using natural language. It uses OpenAI's GPT-4 with function calling to understand user requests and execute actions on the canvas.

## Features Implemented

### Navigation Features

#### 1. Pan to Coordinate
**Function:** `panToCoordinate(x, y)`
- Pans the user's viewport to center on specific world coordinates
- Smart animation:
  - **Smooth animated pan** for distances ≤ 2000px (600ms ease-out cubic)
  - **Instant jump** for distances > 2000px

**Example commands:**
- "Pan to coordinates 500, 300"
- "Center the view on 0, 0"
- "Move my view to position -1000, 2000"

### Inspection Features

#### 2. Get Canvas JSON
**Function:** `getCanvasJSON()`
- Returns the complete canvas state as JSON
- Includes all shapes with their properties:
  - Position (x, y)
  - Size (width, height)
  - Styling (stroke, fill, stroke_width, text_color)
  - Shape type (sides: 0=circle, 3=triangle, 4=rectangle, etc.)
  - Rotation, z-index
  - Text content (text_md)
  - Metadata (created_by, updated_at)

**Example commands:**
- "What shapes are on the canvas?"
- "Show me all the shapes"
- "What's on the canvas?"

#### 3. Get Current Selection
**Function:** `getCurrentSelection()`
- Returns detailed information about currently selected shapes
- Includes:
  - Array of selected shape IDs
  - Count of selected shapes
  - **Full shape details** for each selected shape (automatically enriched)
    - Name, position, size, colors, type, rotation, text content, etc.
- Updates in real-time as the user selects/deselects shapes

**Example commands:**
- "What do I have selected?"
- "What's the name of my selected shape?"
- "Tell me about my selection"
- "What are the properties of the selected shapes?"

#### 4. Get All User Cursors
**Function:** `getAllUserCursors()`
- Returns the current positions of all users on the canvas
- Includes:
  - User ID
  - Email address
  - World coordinates (worldX, worldY)

**Example commands:**
- "Where are other users?"
- "Show me where everyone is"
- "Who's on the canvas and where are they?"

### Shape Modification Features

#### 5. Update Shape Properties
**Function:** `updateShapeProperties(shapeId, updates)`
- Modify any mutable property of a shape
- Supported properties:
  - **Position**: x, y coordinates
  - **Size**: width, height
  - **Shape type**: sides (0=circle, 3=triangle, 4=rectangle, 5+=polygon)
  - **Z-index**: z (layering order)
  - **Colors**: stroke (outline), fill (interior), text_color
  - **Text**: text_md (text content)
- Changes are synced in real-time to all users
- Optimistic updates with rollback on error

**Example commands:**
- "Move BigCircle to position 500, 300"
- "Make the selected shape 200 pixels wide"
- "Change the color of RedSquare to #00ff00"
- "Turn the selected rectangle into a circle"
- "Make this shape bigger" (AI interprets relative changes)
- "Set the fill color to red and stroke to black"

#### 6. Rename Shape
**Function:** `renameShape(shapeId, newName)`
- Rename shapes following the AdjectiveNoun format
- Validation:
  - Must match pattern: `[A-Z][a-z]+[A-Z][a-z]+`
  - Adjective must be from predefined adjective wordlist
  - Noun must be from predefined noun wordlist
  - Name must not be already taken by another shape
- Returns detailed error messages for validation failures

**Example commands:**
- "Rename this shape to BigCircle"
- "Call the selected shape BlueSquare"
- "Change the name to RedTriangle"

**Valid adjectives/nouns:** Loaded from `/public/names/adjectives.txt` and `/public/names/nouns.txt`

#### 7. Add Annotation
**Function:** `addAnnotation(shapeId, text)`
- Add text notes/annotations to shapes
- Annotations are:
  - Visible to all users
  - Stored persistently in database
  - Timestamped with creation date
  - Associated with user who created them
- Multiple annotations can be added to a single shape

**Example commands:**
- "Add a note to this shape: 'needs review'"
- "Annotate BigCircle with 'approved by design team'"
- "Add a comment: 'resize before final'"

### Selection Management Features

#### 8. Add to Selection
**Function:** `addToSelection(shapeIds[])`
- Add one or more shapes to current selection
- Shapes are added (not replaced)
- Invalid shape IDs are filtered out
- Returns count of successfully added shapes

**Example commands:**
- "Select BigCircle"
- "Add RedSquare to my selection"
- "Select all circles" (AI finds circles, then adds them)

#### 9. Remove from Selection
**Function:** `removeFromSelection(shapeIds[])`
- Remove specific shapes from current selection
- Other selected shapes remain selected

**Example commands:**
- "Deselect BigCircle"
- "Remove RedSquare from my selection"

#### 10. Clear Selection
**Function:** `clearSelection()`
- Deselect all shapes

**Example commands:**
- "Clear my selection"
- "Deselect everything"
- "Unselect all"

## UI Features

### Chatbox Interface
- **Collapsed state:** Blue circular icon with sparkle symbol in bottom-right corner
- **Expanded state:** Chat panel (384px wide × 500px tall) that expands upward
  - Message history with user/assistant messages
  - Input field with Enter-to-send
  - Loading indicator with animated dots
  - Helpful example commands when empty

### Positioning
- Fixed to bottom-right corner of the viewport
- Z-index: 9999 (stays on top of canvas elements)
- Rendered via Portal for proper layering

## Technical Implementation

### API Route
**Path:** `/api/ai-chat`
- Accepts POST requests with canvas state
- Uses OpenAI GPT-4o-mini model
- Implements function calling with 4 tools
- Returns AI response and function calls to execute

### Component Structure
```
CanvasViewport (src/components/CanvasViewport.tsx)
├── panToCoordinate() - Pan animation logic
├── encodeCanvasToJSON() - Export canvas state
├── getSelectedShapeIds() - Get selection array
└── getUserCursors() - Get user positions

ChatBox (src/components/ChatBox.tsx)
├── Message history state
├── API communication
├── Function call execution
└── UI rendering (collapsed/expanded)
```

### Data Flow
1. User types message in ChatBox
2. ChatBox collects current canvas state, JSON, selection, and user cursors
3. Sends to `/api/ai-chat` with all context
4. **First AI Call:** OpenAI processes request and determines which functions to call
5. **Function Execution:** Server executes functions and collects results
   - For read-only functions (get*), data is retrieved and formatted
   - For action functions (pan*), success confirmation is generated
6. **Second AI Call:** Function results are sent back to AI to formulate natural language response
7. ChatBox receives AI's response and any action function calls
8. ChatBox executes action functions (like panToCoordinate)
9. AI response displayed to user

**Note:** This two-step process ensures the AI can inspect function results and provide meaningful, contextual answers to questions about the canvas state.

## Environment Variables
Required in `.env.local`:
```bash
OPENAI_API_KEY=sk-proj-...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## Example Multi-Step Interactions

The AI can combine multiple operations intelligently:

### Example 1: Contextual Color Change
**User:** "Make the selected shape red"
1. AI calls `getCurrentSelection()` to get the shape
2. AI calls `updateShapeProperties(shapeId, { fill: "#ff0000" })`
3. AI responds: "I've changed the fill color of BigCircle to red (#ff0000)"

### Example 2: Smart Selection and Modification
**User:** "Select all circles and move them to the right"
1. AI calls `getCanvasJSON()` to find all circles
2. AI calls `addToSelection([...circle IDs...])`
3. For each circle, calls `updateShapeProperties(shapeId, { x: currentX + 100 })`
4. AI responds: "I've selected 3 circles and moved them 100 pixels to the right"

### Example 3: Complex Property Update
**User:** "Make BigCircle bigger, blue, and add a note"
1. AI calls `getCanvasJSON()` to find BigCircle
2. AI calls `updateShapeProperties(BigCircle.id, { width: 200, height: 200, fill: "#0000ff" })`
3. AI calls `addAnnotation(BigCircle.id, "Made larger and blue")`
4. AI responds: "I've made BigCircle bigger (200x200), changed it to blue, and added your note"

## Future Enhancements
Potential features to add:
- **Create shapes**: Generate new rectangles, circles, text from scratch
- **Delete shapes**: Remove shapes from canvas
- **Group/ungroup**: Manage shape hierarchies
- **Layout commands**: Arrange in grid, align, distribute evenly
- **Batch operations**: Apply changes to multiple shapes at once
- **Complex multi-step operations**: Create login forms, navigation bars, wireframes
- **Style presets**: Save and apply style combinations
- **Undo/redo via AI**: "Undo my last change"

## How Questions Are Answered

When you ask the AI a question about the canvas:

1. **"What shapes are on the canvas?"**
   - AI calls `getCanvasJSON()`
   - Receives full canvas state with all shapes
   - Analyzes the data and provides a natural language summary
   - Example response: "You have 3 shapes on the canvas: a red rectangle at (100, 200), a blue circle at (500, 300), and a text element saying 'Hello World' at (150, 450)."

2. **"What do I have selected?"** or **"What's the name of my selected shape?"**
   - AI calls `getCurrentSelection()`
   - Receives **enriched** selection data with full shape details automatically included
   - No need to cross-reference - names and properties are already there
   - Example response: "You have selected 1 shape named 'Header Text' which is a text element at position (450, 120) containing 'Welcome to Canvas'."

3. **"Where are other users?"**
   - AI calls `getAllUserCursors()`
   - Receives positions and emails of all users
   - Formats into readable response
   - Example response: "There are 2 other users: alice@example.com is at position (450, 680) and bob@example.com is at position (-200, 300)."

The AI can combine multiple function calls in a single response and provide intelligent, contextual answers based on the actual canvas state.

## Testing
To test the AI assistant:
1. Open the canvas page (must be logged in)
2. Click the sparkle icon in bottom-right
3. Try the example commands
4. Experiment with natural language variations
5. Ask follow-up questions about the canvas state

## Notes
- The AI has full context of the canvas state on every request
- All actions are executed in real-time and synced to other users
- The assistant can understand natural language variations of commands
- For multi-user scenarios, the AI is aware of all active users and their locations

