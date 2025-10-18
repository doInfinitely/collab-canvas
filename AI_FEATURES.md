# AI Canvas Assistant Features

## Overview
The AI Canvas Assistant is an AI-powered chatbox that allows users to interact with the collaborative canvas using natural language. It uses OpenAI's GPT-4 with function calling to understand user requests and execute actions on the canvas.

## Features Implemented

### 1. Pan to Coordinate
**Function:** `panToCoordinate(x, y)`
- Pans the user's viewport to center on specific world coordinates
- Smart animation:
  - **Smooth animated pan** for distances ≤ 2000px (600ms ease-out cubic)
  - **Instant jump** for distances > 2000px

**Example commands:**
- "Pan to coordinates 500, 300"
- "Center the view on 0, 0"
- "Move my view to position -1000, 2000"

### 2. Get Canvas JSON
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

### 3. Get Current Selection
**Function:** `getCurrentSelection()`
- Returns an array of shape IDs that are currently selected by the user
- Updates in real-time as the user selects/deselects shapes

**Example commands:**
- "What do I have selected?"
- "What am I selecting?"
- "Tell me about my selection"

### 4. Get All User Cursors
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

## Future Enhancements
Potential features to add:
- Create shapes (rectangles, circles, text)
- Modify shapes (move, resize, recolor)
- Delete shapes
- Group/ungroup shapes
- Layout commands (arrange in grid, align, distribute)
- Complex multi-step operations (create login form, navigation bar, etc.)

## How Questions Are Answered

When you ask the AI a question about the canvas:

1. **"What shapes are on the canvas?"**
   - AI calls `getCanvasJSON()`
   - Receives full canvas state with all shapes
   - Analyzes the data and provides a natural language summary
   - Example response: "You have 3 shapes on the canvas: a red rectangle at (100, 200), a blue circle at (500, 300), and a text element saying 'Hello World' at (150, 450)."

2. **"What do I have selected?"**
   - AI calls `getCurrentSelection()`
   - Receives array of selected shape IDs
   - Cross-references with canvas data
   - Example response: "You have 2 shapes selected: the red rectangle and the blue circle."

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

