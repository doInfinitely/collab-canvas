import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, messageHistory, canvasState, canvasJSON, selectedShapeIds, userCursors, uiState } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Prepare system message with canvas context
    const systemMessage = `You are an AI assistant that helps users control and manipulate a collaborative canvas. 
Current canvas state:
- Center position: (${canvasState?.centerX ?? 0}, ${canvasState?.centerY ?? 0})
- Zoom scale: ${canvasState?.scale ?? 1} (${Math.round((canvasState?.scale ?? 1) * 100)}%)
- Viewport dimensions: ${canvasState?.viewportWidth ?? 0}x${canvasState?.viewportHeight ?? 0}
- Selected shapes: ${selectedShapeIds?.length ?? 0} shape(s) selected
- Active users: ${userCursors?.length ?? 0} user(s) on canvas
- Shape modal: ${uiState?.shapeModalOpen ? `Open (${uiState.shapeModalShapeId})` : 'Closed'}
- Debug HUD: ${uiState?.debugHUDVisible ? 'Visible' : 'Hidden'}
- Canvas menu: ${uiState?.canvasMenuOpen ? `Open (${uiState.canvasMenuTab} tab)` : 'Closed'}
- Available versions: ${uiState?.availableVersions?.length ?? 0} saved version(s)

CAPABILITIES:
1. VIEWPORT CONTROL: Pan to coordinates, set zoom level, read/write viewport state (zoom + pan combined)
2. INSPECTION: View canvas, selections, user locations, viewport state, and UI state
3. CREATE: Add new shapes to the canvas
4. DELETE: Remove shapes from the canvas
5. MODIFICATION: Update shape properties (position, size, colors, text, sides, z-index)
6. NAMING: Rename shapes (must use AdjectiveNoun format from wordlists)
7. ANNOTATION: Add notes to shapes
8. SELECTION: Add/remove shapes from selection or clear selection
9. UI CONTROL: Open/close/toggle shape modals, debug HUD, canvas menu
10. EXPORT: Download canvas as PNG, SVG, or JSON
11. VERSIONING: Save current state or restore previous versions

IMPORTANT NOTES:
- World coordinates are in pixels where (0,0) is the origin
- getCurrentSelection() returns enriched data with full shape details
- Colors must be in hex format (e.g., #ff0000 for red)
- Shape types: sides=0 (circle), 3 (triangle), 4 (rectangle), 5+ (polygon)
- When renaming, only use adjectives and nouns from the predefined wordlists
- You MUST call the appropriate function to make changes - don't just describe what you would do
- Version restore: users can refer to versions by date/time, "last version", "penultimate", "5 versions ago"
- Zoom and pan are coupled: you can zoom to a specific point using setZoom with focusX/focusY
- Use getViewport() to read current pan and zoom together

CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE:

1. BATCHING (VERY IMPORTANT): When operating on multiple shapes, ALWAYS use batch functions
   - ✅ CORRECT: createShapes([...400 shapes...]) - ONE call for all shapes
   - ❌ WRONG: 400 separate createShape() calls - this is slow and inefficient!
   - ✅ CORRECT: updateShapesProperties([id1, id2, ...], { fill: '#ff0000' }) - ONE call
   - ❌ WRONG: Multiple updateShapeProperties calls with same changes
   - ✅ CORRECT: addAnnotations([{shapeId, text}, ...]) - ONE call for all annotations
   - ✅ CORRECT: deleteShapes([id1, id2, ..., id100]) - ONE call with ALL IDs
   - BATCH FUNCTIONS: createShapes, updateShapesProperties, addAnnotations, deleteShapes, addToSelection, removeFromSelection
   - LIMIT: Maximum 128 tool calls per round - batching keeps you well under this!

2. MULTI-ROUND OPERATIONS: You can make up to 50 rounds of function calls
   - For large batch operations, use batch functions like createShapes (creates all shapes in ONE call)
   - The system will automatically handle multiple rounds - keep making calls until the task is complete
   - Don't stop early - complete the entire request in one conversation turn
   - IMPORTANT: If user says "continue" for a grid/pattern, first call getCanvasJSON() to see what shapes exist, analyze their positions/pattern, then continue from where you left off

3. WORKFLOW: When modifying shapes:
   - For SELECTED shapes: Use updateSelectionProperties directly - no need to call getCurrentSelection first!
   - For OTHER shapes: Call getCanvasJSON() to find targets, then call action functions with the IDs
   - Make both function calls together in your initial response

4. EXECUTION: Don't just explain - ACTUALLY CALL THE FUNCTIONS
   - Use parallel function calls when possible
   - Batch operations on multiple shapes into single calls
   - For selection operations, use updateSelectionProperties (most efficient!)

Example for "create 400 circles in a grid":
- Round 1: Call getViewport() to get the visible area
- Round 2: Call createShapes([...all 400 shape specs...]) - ONE call with all 400 shapes!
- Result: All 400 shapes created in just 2 rounds with ONE batch call
- NOTE: Use createShapes (plural) for multiple shapes, NOT multiple createShape calls!

Example for "continue creating circles" (after previous grid):
- Round 1: Call getCanvasJSON() to see existing shapes
- Round 2+: Analyze the grid pattern (spacing, dimensions) and continue from shape 400+

Example for "delete all small shapes":
- Call getCanvasJSON() - finds 50 shapes smaller than threshold
- Call deleteShapes([id1, id2, ..., id50]) - ONE call with ALL 50 IDs

Example for "make the selected shapes blue" (MOST EFFICIENT):
- Call updateSelectionProperties({ fill: '#0000ff' }) - ONE call, no need to read selection!
- NOT: getCurrentSelection() + updateShapesProperties() - this is less efficient`;

    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'panToCoordinate',
          description: 'Pan the user\'s viewport to center on specific x,y world coordinates',
          parameters: {
            type: 'object',
            properties: {
              x: {
                type: 'number',
                description: 'The x-coordinate in world space to pan to',
              },
              y: {
                type: 'number',
                description: 'The y-coordinate in world space to pan to',
              },
            },
            required: ['x', 'y'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getCanvasJSON',
          description: 'Get the complete canvas state as JSON, including all shapes with their properties. Each shape has: id, name, position (x, y), size (width, height), colors (stroke, fill, text_color), shape type (sides: 0=circle, 3=triangle, 4=rectangle, 5+=polygon), rotation, z-index, text content (text_md), and metadata (created_by, updated_at). Use this to look up detailed information about shapes.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getCurrentSelection',
          description: 'Get the IDs of all currently selected shapes on the canvas. Returns an array of shape IDs. To get details about these shapes (like their names or properties), you must also call getCanvasJSON() and match the IDs.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getAllUserCursors',
          description: 'Get the current positions of all users on the canvas, including their email addresses and world coordinates',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'updateShapeProperties',
          description: 'REQUIRED ACTION FUNCTION: Update one or more properties of a shape. After calling getCanvasJSON to find a shape, you MUST call this function to actually apply changes. You can change: position (x, y), size (width, height), number of sides, z-index (z), stroke color, fill color, text_color, or text content (text_md). IMPORTANT: When modifying shapes, call getCanvasJSON first, then call this function immediately with the shape ID you found.',
          parameters: {
            type: 'object',
            properties: {
              shapeId: {
                type: 'string',
                description: 'The ID of the shape to update (get this from getCanvasJSON or getCurrentSelection)',
              },
              updates: {
                type: 'object',
                description: 'Object containing the properties to update. Can include: x, y, width, height, sides (0=circle, 3=triangle, 4=rectangle, 5+=polygon), z (z-index), stroke (hex color), fill (hex color or null), text_color (hex color), text_md (text content)',
                properties: {
                  x: { type: 'number', description: 'X position in pixels' },
                  y: { type: 'number', description: 'Y position in pixels' },
                  width: { type: 'number', description: 'Width in pixels' },
                  height: { type: 'number', description: 'Height in pixels' },
                  sides: { type: 'number', description: 'Number of sides (0=circle, 3=triangle, 4=rectangle, 6=hexagon, 7=heptagon, etc)' },
                  z: { type: 'number', description: 'Z-index for layering' },
                  stroke: { type: 'string', description: 'Outline color in hex format' },
                  fill: { type: ['string', 'null'], description: 'Fill color in hex or null' },
                  text_color: { type: 'string', description: 'Text color in hex format' },
                  text_md: { type: 'string', description: 'Text content' },
                },
              },
            },
            required: ['shapeId', 'updates'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'updateShapesProperties',
          description: 'Update the same properties for multiple shapes at once. More efficient than multiple updateShapeProperties calls when applying the same changes to many shapes (e.g., moving all selected shapes, changing color of all circles, etc). IMPORTANT: Shape IDs are strings (UUIDs). When parsing canvas JSON, extract the "id" field from each shape object (e.g., shapes.map(s => s.id)).',
          parameters: {
            type: 'object',
            properties: {
              shapeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of shape IDs (strings) to update. Extract these from shape.id in the canvas JSON.',
              },
              updates: {
                type: 'object',
                description: 'Properties to update for all specified shapes. Can include: x, y, width, height, sides, z, stroke, fill, text_color, text_md',
                properties: {
                  x: { type: 'number', description: 'X position in pixels' },
                  y: { type: 'number', description: 'Y position in pixels' },
                  width: { type: 'number', description: 'Width in pixels' },
                  height: { type: 'number', description: 'Height in pixels' },
                  sides: { type: 'number', description: 'Number of sides' },
                  z: { type: 'number', description: 'Z-index' },
                  stroke: { type: 'string', description: 'Outline color in hex format' },
                  fill: { type: ['string', 'null'], description: 'Fill color in hex or null' },
                  text_color: { type: 'string', description: 'Text color in hex format' },
                  text_md: { type: 'string', description: 'Text content' },
                },
              },
            },
            required: ['shapeIds', 'updates'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'updateSelectionProperties',
          description: 'Update properties for all currently selected shapes. This is MORE EFFICIENT than calling getCurrentSelection + updateShapesProperties because you don\'t need to read/echo back the selection IDs. Perfect for "make the selected shapes blue" or "resize the selection to 100x100".',
          parameters: {
            type: 'object',
            properties: {
              updates: {
                type: 'object',
                description: 'Properties to update for all selected shapes. Can include: x, y, width, height, sides, z, stroke, fill, text_color, text_md',
                properties: {
                  x: { type: 'number', description: 'X position in pixels' },
                  y: { type: 'number', description: 'Y position in pixels' },
                  width: { type: 'number', description: 'Width in pixels' },
                  height: { type: 'number', description: 'Height in pixels' },
                  sides: { type: 'number', description: 'Number of sides' },
                  z: { type: 'number', description: 'Z-index' },
                  stroke: { type: 'string', description: 'Outline color in hex format' },
                  fill: { type: ['string', 'null'], description: 'Fill color in hex or null' },
                  text_color: { type: 'string', description: 'Text color in hex format' },
                  text_md: { type: 'string', description: 'Text content' },
                },
              },
            },
            required: ['updates'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'renameShape',
          description: 'Rename a shape following the AdjectiveNoun format (e.g., BigCircle, RedSquare). The adjective and noun must be from the predefined wordlists. The name must not be already taken by another shape.',
          parameters: {
            type: 'object',
            properties: {
              shapeId: {
                type: 'string',
                description: 'The ID of the shape to rename',
              },
              newName: {
                type: 'string',
                description: 'The new name in AdjectiveNoun format (e.g., BigCircle)',
              },
            },
            required: ['shapeId', 'newName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'addAnnotation',
          description: 'Add a text annotation/note to a shape. Annotations are visible to all users and stored persistently.',
          parameters: {
            type: 'object',
            properties: {
              shapeId: {
                type: 'string',
                description: 'The ID of the shape to annotate',
              },
              text: {
                type: 'string',
                description: 'The annotation text',
              },
            },
            required: ['shapeId', 'text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'addAnnotations',
          description: 'Add text annotations to multiple shapes at once. More efficient than multiple addAnnotation calls.',
          parameters: {
            type: 'object',
            properties: {
              annotations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    shapeId: { type: 'string', description: 'The ID of the shape to annotate' },
                    text: { type: 'string', description: 'The annotation text' },
                  },
                  required: ['shapeId', 'text'],
                },
                description: 'Array of annotations to add',
              },
            },
            required: ['annotations'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'addToSelection',
          description: 'Add one or more shapes to the current selection. ALWAYS pass ALL IDs in a single call! Shapes are added to the existing selection (not replaced).',
          parameters: {
            type: 'object',
            properties: {
              shapeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of ALL shape IDs to add to selection in this single call',
              },
            },
            required: ['shapeIds'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'removeFromSelection',
          description: 'Remove one or more shapes from the current selection. ALWAYS pass ALL IDs in a single call!',
          parameters: {
            type: 'object',
            properties: {
              shapeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of ALL shape IDs to remove from selection in this single call',
              },
            },
            required: ['shapeIds'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'clearSelection',
          description: 'Clear the current selection (deselect all shapes).',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getUIState',
          description: 'Get current UI state including open modals, HUD visibility, canvas menu state, and available saved versions.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'createShape',
          description: 'Create a new shape on the canvas with specified properties. The shape will be automatically assigned a unique name from the wordlists. Note: All numeric values will be rounded to integers.',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X position in pixels (will be rounded)' },
              y: { type: 'number', description: 'Y position in pixels (will be rounded)' },
              width: { type: 'number', description: 'Width in pixels (will be rounded)' },
              height: { type: 'number', description: 'Height in pixels (will be rounded)' },
              sides: { type: 'number', description: 'Number of sides (0=circle, 3=triangle, 4=rectangle, 5+=polygon). Default: 4' },
              stroke: { type: 'string', description: 'Outline color in hex format. Default: #000000' },
              fill: { type: ['string', 'null'], description: 'Fill color in hex or null for transparent. Default: #ffffff' },
              text_md: { type: 'string', description: 'Text content (optional)' },
              text_color: { type: 'string', description: 'Text color in hex format. Default: #000000' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'createShapes',
          description: 'Create multiple shapes at once in a single call. MUCH MORE EFFICIENT than multiple createShape calls! Use this for creating many shapes (e.g., 400 shapes in a grid). All numeric values will be rounded to integers.',
          parameters: {
            type: 'object',
            properties: {
              shapes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    x: { type: 'number', description: 'X position in pixels (will be rounded)' },
                    y: { type: 'number', description: 'Y position in pixels (will be rounded)' },
                    width: { type: 'number', description: 'Width in pixels (will be rounded)' },
                    height: { type: 'number', description: 'Height in pixels (will be rounded)' },
                    sides: { type: 'number', description: 'Number of sides (0=circle, 3=triangle, 4=rectangle, 5+=polygon). Default: 4' },
                    stroke: { type: 'string', description: 'Outline color in hex format. Default: #000000' },
                    fill: { type: ['string', 'null'], description: 'Fill color in hex or null for transparent. Default: #ffffff' },
                    text_md: { type: 'string', description: 'Text content (optional)' },
                    text_color: { type: 'string', description: 'Text color in hex format. Default: #000000' },
                  },
                  required: ['x', 'y', 'width', 'height'],
                },
                description: 'Array of shape specifications to create',
              },
            },
            required: ['shapes'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'deleteShapes',
          description: 'Delete one or more shapes from the canvas. ALWAYS pass ALL IDs in a single call - never make multiple deleteShapes calls! Example: deleteShapes([id1, id2, ..., id100]) NOT 100 separate calls. Use getCanvasJSON to find shape IDs first.',
          parameters: {
            type: 'object',
            properties: {
              shapeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of ALL shape IDs to delete in this single call',
              },
            },
            required: ['shapeIds'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'toggleShapeModal',
          description: 'Open, close, or toggle the shape properties modal.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['open', 'close', 'toggle'],
                description: 'Action to perform: open, close, or toggle the modal',
              },
              shapeId: {
                type: 'string',
                description: 'Shape ID to open modal for (required if action is "open")',
              },
            },
            required: ['action'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'toggleDebugHUD',
          description: 'Show, hide, or toggle the debug HUD that displays current scroll position, scale, and other debug info.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['show', 'hide', 'toggle'],
                description: 'Action to perform: show, hide, or toggle',
              },
            },
            required: ['action'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'toggleCanvasMenu',
          description: 'Show, hide, or toggle the canvas menu (export/versions menu).',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['show', 'hide', 'toggle'],
                description: 'Action to perform: show, hide, or toggle',
              },
              tab: {
                type: 'string',
                enum: ['export', 'versions'],
                description: 'Which tab to show when opening (optional)',
              },
            },
            required: ['action'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'downloadPNG',
          description: 'Download the current canvas as a PNG image.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'downloadSVG',
          description: 'Download the current canvas as an SVG vector image.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'downloadJSON',
          description: 'Download the current canvas state as a JSON file (for backup/restore).',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'saveVersion',
          description: 'Save the current canvas state as a new version.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'restoreVersion',
          description: 'Restore a previously saved canvas version. Users can refer to versions by: version ID, date/time string (partial match ok), "last" or 0 (most recent), "penultimate" or 1 (second most recent), or any number indicating versions ago (e.g., 5 = fifth most recent).',
          parameters: {
            type: 'object',
            properties: {
              identifier: {
                type: ['string', 'number'],
                description: 'Version identifier: version ID, date/time substring, 0/"last" for most recent, 1/"penultimate" for second most recent, N for Nth most recent',
              },
            },
            required: ['identifier'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'getViewport',
          description: 'Get the current viewport state including offset (pan/scroll position), center coordinates, and zoom level. Returns: offsetX, offsetY (top-left corner), centerX, centerY (viewport center in world coordinates), zoom (scale factor), viewportWidth, viewportHeight.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'setZoom',
          description: 'Set the zoom level (scale) of the canvas, optionally focusing on a specific point. If focusX and focusY are provided, the viewport will pan to keep that world coordinate centered while zooming. 1.0 = 100% (normal), 2.0 = 200% (zoomed in), 0.5 = 50% (zoomed out). Valid range: 0.1 to 5.0 (10% to 500%). Examples: "Zoom to 200%" (simple zoom), "Zoom to 150% on coordinate 500, 500" (zoom with focus).',
          parameters: {
            type: 'object',
            properties: {
              zoomLevel: {
                type: 'number',
                description: 'The zoom level to set. 1.0 = 100%, 2.0 = 200%, 0.5 = 50%. Range: 0.1-5.0',
              },
              focusX: {
                type: 'number',
                description: 'Optional: World X coordinate to keep centered while zooming',
              },
              focusY: {
                type: 'number',
                description: 'Optional: World Y coordinate to keep centered while zooming',
              },
            },
            required: ['zoomLevel'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'setPan',
          description: 'Set the pan/scroll position of the canvas by directly setting the offset (top-left corner position). For centering on a coordinate, use panToCoordinate instead. This is for setting raw offset values.',
          parameters: {
            type: 'object',
            properties: {
              x: {
                type: 'number',
                description: 'The X offset (left edge of viewport in world coordinates)',
              },
              y: {
                type: 'number',
                description: 'The Y offset (top edge of viewport in world coordinates)',
              },
            },
            required: ['x', 'y'],
          },
        },
      },
    ];

    // Build messages array with conversation history
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemMessage },
    ];

    // Add previous conversation history if provided
    if (messageHistory && Array.isArray(messageHistory)) {
      // Filter out any system messages from history and add user/assistant messages
      const validHistory = messageHistory.filter(
        (msg: any) => msg.role === 'user' || msg.role === 'assistant'
      );
      messages.push(...validHistory);
    }

    // Add the new user message
    messages.push({ role: 'user', content: message });

    console.log(`API: Processing message with ${messages.length - 2} history messages`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
    });

    const responseMessage = completion.choices[0].message;

    // Check if AI wants to call functions
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      console.log('API: AI made', responseMessage.tool_calls.length, 'tool calls');
      responseMessage.tool_calls.forEach((tc, i) => {
        console.log(`API: Tool call ${i + 1}:`, tc.type, tc.type === 'function' ? tc.function.name : 'N/A');
      });
      
      // Add the assistant's response with tool calls to messages
      messages.push(responseMessage);

      // Execute each function call and collect results
      const actionFunctionCalls: Array<{
        id: string;
        name: string;
        arguments: any;
      }> = [];

      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type !== 'function') continue;

        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        // For read-only functions, get the data
        let functionResult;
        if (functionName === 'getCanvasJSON') {
          functionResult = canvasJSON;
      } else if (functionName === 'getCurrentSelection') {
        // Parse canvas JSON to enrich selection data with shape details
        try {
          const canvas = JSON.parse(canvasJSON);
          if (canvas.shapes) {
            const selectedShapes = canvas.shapes.filter((s: any) => 
              selectedShapeIds.includes(s.id)
            );
            functionResult = JSON.stringify({ 
              selectedIds: selectedShapeIds,
              count: selectedShapeIds.length,
              shapes: selectedShapes 
            }, null, 2);
          } else {
            functionResult = JSON.stringify({ selectedIds: selectedShapeIds, count: selectedShapeIds.length });
          }
        } catch {
          functionResult = JSON.stringify({ selectedIds: selectedShapeIds, count: selectedShapeIds.length });
        }
      } else if (functionName === 'getAllUserCursors') {
        functionResult = JSON.stringify({ users: userCursors, count: userCursors.length }, null, 2);
      } else if (functionName === 'getUIState') {
        functionResult = JSON.stringify(uiState, null, 2);
      } else if (functionName === 'getViewport') {
        const viewportInfo = {
          offsetX: canvasState?.centerX ? canvasState.centerX - canvasState.viewportWidth / 2 / canvasState.scale : 0,
          offsetY: canvasState?.centerY ? canvasState.centerY - canvasState.viewportHeight / 2 / canvasState.scale : 0,
          centerX: canvasState?.centerX ?? 0,
          centerY: canvasState?.centerY ?? 0,
          zoom: canvasState?.scale ?? 1,
          viewportWidth: canvasState?.viewportWidth ?? 0,
          viewportHeight: canvasState?.viewportHeight ?? 0,
        };
        functionResult = JSON.stringify(viewportInfo, null, 2);
      } else if (functionName === 'panToCoordinate') {
        functionResult = JSON.stringify({ success: true, x: args.x, y: args.y });
        actionFunctionCalls.push({
          id: toolCall.id,
          name: functionName,
          arguments: args,
        });
      } else if (functionName === 'updateShapeProperties') {
          functionResult = JSON.stringify({ success: true, message: `Updated properties of shape ${args.shapeId}` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'renameShape') {
          functionResult = JSON.stringify({ success: true, message: `Renamed shape ${args.shapeId} to ${args.newName}` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'addAnnotation') {
          functionResult = JSON.stringify({ success: true, message: `Added annotation to shape ${args.shapeId}` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'addToSelection') {
          functionResult = JSON.stringify({ success: true, message: `Added ${args.shapeIds.length} shape(s) to selection` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'removeFromSelection') {
          functionResult = JSON.stringify({ success: true, message: `Removed ${args.shapeIds.length} shape(s) from selection` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'clearSelection') {
          functionResult = JSON.stringify({ success: true, message: 'Cleared selection' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'getUIState') {
          functionResult = JSON.stringify(uiState, null, 2);
        } else if (functionName === 'createShape') {
          functionResult = JSON.stringify({ success: true, message: 'Shape created' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'createShapes') {
          functionResult = JSON.stringify({ success: true, message: `Created ${args.shapes.length} shapes` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'addAnnotations') {
          functionResult = JSON.stringify({ success: true, message: `Added ${args.annotations.length} annotations` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'updateShapesProperties') {
          console.log('API: updateShapesProperties called with', args.shapeIds?.length || 0, 'shape IDs');
          console.log('API: First few IDs:', args.shapeIds?.slice(0, 5));
          functionResult = JSON.stringify({ success: true, message: `Updated ${args.shapeIds?.length || 0} shapes` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'updateSelectionProperties') {
          functionResult = JSON.stringify({ success: true, message: 'Updated selected shapes' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'deleteShapes') {
          functionResult = JSON.stringify({ success: true, message: `Deleted ${args.shapeIds.length} shape(s)` });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'toggleShapeModal') {
          functionResult = JSON.stringify({ success: true, action: args.action });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'toggleDebugHUD') {
          functionResult = JSON.stringify({ success: true, action: args.action });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'toggleCanvasMenu') {
          functionResult = JSON.stringify({ success: true, action: args.action, tab: args.tab });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'downloadPNG') {
          functionResult = JSON.stringify({ success: true, message: 'PNG download initiated' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'downloadSVG') {
          functionResult = JSON.stringify({ success: true, message: 'SVG download initiated' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'downloadJSON') {
          functionResult = JSON.stringify({ success: true, message: 'JSON download initiated' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'saveVersion') {
          functionResult = JSON.stringify({ success: true, message: 'Version saved' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'restoreVersion') {
          functionResult = JSON.stringify({ success: true, message: 'Version restored' });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'getViewport') {
          // Get viewport info from canvasState
          const viewportInfo = {
            offsetX: canvasState?.centerX ? canvasState.centerX - canvasState.viewportWidth / 2 / canvasState.scale : 0,
            offsetY: canvasState?.centerY ? canvasState.centerY - canvasState.viewportHeight / 2 / canvasState.scale : 0,
            centerX: canvasState?.centerX ?? 0,
            centerY: canvasState?.centerY ?? 0,
            zoom: canvasState?.scale ?? 1,
            viewportWidth: canvasState?.viewportWidth ?? 0,
            viewportHeight: canvasState?.viewportHeight ?? 0,
          };
          functionResult = JSON.stringify(viewportInfo, null, 2);
        } else if (functionName === 'setZoom') {
          functionResult = JSON.stringify({ success: true, zoom: args.zoomLevel, focusX: args.focusX, focusY: args.focusY });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        } else if (functionName === 'setPan') {
          functionResult = JSON.stringify({ success: true, offsetX: args.x, offsetY: args.y });
          actionFunctionCalls.push({
            id: toolCall.id,
            name: functionName,
            arguments: args,
          });
        }

        // Add function result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: functionResult || 'Success',
        });
      }

      // Continue making calls until AI stops requesting tool calls
      let roundNumber = 2;
      const MAX_ROUNDS = 50; // Allow up to 50 rounds for complex operations like creating 400 shapes
      let continueLoop = true;
      
      while (continueLoop && roundNumber <= MAX_ROUNDS) {
        const nextCompletion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages,
          tools,
          tool_choice: 'auto',
        });

        const nextMessage = nextCompletion.choices[0].message;

        // Check if AI wants to call MORE functions
        if (nextMessage.tool_calls && nextMessage.tool_calls.length > 0) {
          console.log(`API: AI made ${nextMessage.tool_calls.length} more tool calls in round ${roundNumber}`);
        
          // Add response to messages
          messages.push(nextMessage);

          // Execute these additional function calls
          for (const toolCall of nextMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;

          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          let functionResult;
          // Handle read-only functions first
          if (functionName === 'getCanvasJSON') {
            functionResult = canvasJSON;
          } else if (functionName === 'getCurrentSelection') {
            try {
              const canvas = JSON.parse(canvasJSON);
              if (canvas.shapes) {
                const selectedShapes = canvas.shapes.filter((s: any) => 
                  selectedShapeIds.includes(s.id)
                );
                functionResult = JSON.stringify({ 
                  selectedIds: selectedShapeIds,
                  count: selectedShapeIds.length,
                  shapes: selectedShapes 
                }, null, 2);
              } else {
                functionResult = JSON.stringify({ selectedIds: selectedShapeIds, count: selectedShapeIds.length });
              }
            } catch {
              functionResult = JSON.stringify({ selectedIds: selectedShapeIds, count: selectedShapeIds.length });
            }
          } else if (functionName === 'getAllUserCursors') {
            functionResult = JSON.stringify({ users: userCursors, count: userCursors.length }, null, 2);
          } else if (functionName === 'getUIState') {
            functionResult = JSON.stringify(uiState, null, 2);
          } else if (functionName === 'getViewport') {
            const viewportInfo = {
              offsetX: canvasState?.centerX ? canvasState.centerX - canvasState.viewportWidth / 2 / canvasState.scale : 0,
              offsetY: canvasState?.centerY ? canvasState.centerY - canvasState.viewportHeight / 2 / canvasState.scale : 0,
              centerX: canvasState?.centerX ?? 0,
              centerY: canvasState?.centerY ?? 0,
              zoom: canvasState?.scale ?? 1,
              viewportWidth: canvasState?.viewportWidth ?? 0,
              viewportHeight: canvasState?.viewportHeight ?? 0,
            };
            functionResult = JSON.stringify(viewportInfo, null, 2);
          } else if (functionName === 'updateShapeProperties') {
            functionResult = JSON.stringify({ success: true, message: `Updated properties of shape ${args.shapeId}` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'renameShape') {
            functionResult = JSON.stringify({ success: true, message: `Renamed shape ${args.shapeId} to ${args.newName}` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'addAnnotation') {
            functionResult = JSON.stringify({ success: true, message: `Added annotation to shape ${args.shapeId}` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'addToSelection') {
            functionResult = JSON.stringify({ success: true, message: `Added ${args.shapeIds.length} shape(s) to selection` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'removeFromSelection') {
            functionResult = JSON.stringify({ success: true, message: `Removed ${args.shapeIds.length} shape(s) from selection` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'clearSelection') {
            functionResult = JSON.stringify({ success: true, message: 'Cleared selection' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'panToCoordinate') {
            functionResult = JSON.stringify({ success: true, x: args.x, y: args.y });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'createShape') {
            functionResult = JSON.stringify({ success: true, message: 'Shape created' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'createShapes') {
            functionResult = JSON.stringify({ success: true, message: `Created ${args.shapes.length} shapes` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'addAnnotations') {
            functionResult = JSON.stringify({ success: true, message: `Added ${args.annotations.length} annotations` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'updateShapesProperties') {
            console.log('API (round ' + roundNumber + '): updateShapesProperties called with', args.shapeIds?.length || 0, 'shape IDs');
            console.log('API: First few IDs:', args.shapeIds?.slice(0, 5));
            functionResult = JSON.stringify({ success: true, message: `Updated ${args.shapeIds?.length || 0} shapes` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'updateSelectionProperties') {
            functionResult = JSON.stringify({ success: true, message: 'Updated selected shapes' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'deleteShapes') {
            functionResult = JSON.stringify({ success: true, message: `Deleted ${args.shapeIds.length} shape(s)` });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'toggleShapeModal') {
            functionResult = JSON.stringify({ success: true, action: args.action });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'toggleDebugHUD') {
            functionResult = JSON.stringify({ success: true, action: args.action });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'toggleCanvasMenu') {
            functionResult = JSON.stringify({ success: true, action: args.action, tab: args.tab });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'downloadPNG') {
            functionResult = JSON.stringify({ success: true, message: 'PNG download initiated' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'downloadSVG') {
            functionResult = JSON.stringify({ success: true, message: 'SVG download initiated' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'downloadJSON') {
            functionResult = JSON.stringify({ success: true, message: 'JSON download initiated' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'saveVersion') {
            functionResult = JSON.stringify({ success: true, message: 'Version saved' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'restoreVersion') {
            functionResult = JSON.stringify({ success: true, message: 'Version restored' });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'setZoom') {
            functionResult = JSON.stringify({ success: true, zoom: args.zoomLevel, focusX: args.focusX, focusY: args.focusY });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          } else if (functionName === 'setPan') {
            functionResult = JSON.stringify({ success: true, offsetX: args.x, offsetY: args.y });
            actionFunctionCalls.push({
              id: toolCall.id,
              name: functionName,
              arguments: args,
            });
          }

          // Add function results
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: functionResult || 'Success',
          });
        }

          // Continue to next round
          roundNumber++;
        } else {
          // No more tool calls, exit loop
          continueLoop = false;
        }
      }

      // Make final call to get natural language response
      const finalCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
      });

      const finalMessage = finalCompletion.choices[0].message;

      console.log(`API: Returning response with ${actionFunctionCalls.length} function calls (after ${roundNumber - 1} rounds)`);
      console.log('API: Function calls:', JSON.stringify(actionFunctionCalls, null, 2));

      return NextResponse.json({
        message: finalMessage.content || 'I\'ve processed your request.',
        functionCalls: actionFunctionCalls,
      });
    }

    // No function calls, just return the message
    console.log('API: No function calls, returning message only');
    return NextResponse.json({
      message: responseMessage.content || '',
      functionCalls: [],
    });
  } catch (error) {
    console.error('AI Chat API Error:', error);
    return NextResponse.json(
      { error: 'Failed to process AI request' },
      { status: 500 }
    );
  }
}

