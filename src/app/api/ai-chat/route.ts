import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, canvasState, canvasJSON, selectedShapeIds, userCursors } = body;

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
- Zoom scale: ${canvasState?.scale ?? 1}
- Viewport dimensions: ${canvasState?.viewportWidth ?? 0}x${canvasState?.viewportHeight ?? 0}
- Selected shapes: ${selectedShapeIds?.length ?? 0} shape(s) selected
- Active users: ${userCursors?.length ?? 0} user(s) on canvas

CAPABILITIES:
1. NAVIGATION: Pan to coordinates
2. INSPECTION: View canvas, selections, and user locations
3. MODIFICATION: Update shape properties (position, size, colors, text, sides, z-index)
4. NAMING: Rename shapes (must use AdjectiveNoun format from wordlists)
5. ANNOTATION: Add notes to shapes
6. SELECTION: Add/remove shapes from selection or clear selection

IMPORTANT NOTES:
- World coordinates are in pixels where (0,0) is the origin
- getCurrentSelection() returns enriched data with full shape details
- Colors must be in hex format (e.g., #ff0000 for red)
- Shape types: sides=0 (circle), 3 (triangle), 4 (rectangle), 5+ (polygon)
- When renaming, only use adjectives and nouns from the predefined wordlists
- You MUST call the appropriate function to make changes - don't just describe what you would do

CRITICAL INSTRUCTION - YOU MUST FOLLOW THIS:
When users ask you to modify shapes, you must make TWO function calls:
1. First call getCanvasJSON() or getCurrentSelection() to find the target shape and get its ID
2. Then call updateShapeProperties(shapeId, updates) with the ID you found

You MUST call BOTH functions together in your initial response. Don't just call one and wait.

Example for "add one side to the hexagon":
- Call getCanvasJSON() - you'll find the hexagon shape with sides=6 and its ID
- Call updateShapeProperties(hexagonId, { sides: 7 }) - using the ID from the canvas data
- Both calls should be made together, then you'll receive the results and can confirm

DO NOT just explain what you would do - ACTUALLY CALL THE FUNCTIONS.
Make both function calls in parallel in your response.`;

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
          name: 'addToSelection',
          description: 'Add one or more shapes to the current selection. Shapes are added to the existing selection (not replaced).',
          parameters: {
            type: 'object',
            properties: {
              shapeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of shape IDs to add to selection',
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
          description: 'Remove one or more shapes from the current selection.',
          parameters: {
            type: 'object',
            properties: {
              shapeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of shape IDs to remove from selection',
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
    ];

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', // Using full GPT-4o for better function calling
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
          let enrichedSelection = selectedShapeIds;
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
        } else if (functionName === 'panToCoordinate') {
          // For action functions, just acknowledge
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
        }

        // Add function result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: functionResult || 'Success',
        });
      }

      // Make second call - AI might call MORE functions after seeing the results
      const secondCompletion = await openai.chat.completions.create({
        model: 'gpt-4o', // Using full GPT-4o for better function calling
        messages,
        tools, // IMPORTANT: Allow AI to call more functions
        tool_choice: 'auto',
      });

      const secondMessage = secondCompletion.choices[0].message;

      // Check if AI wants to call MORE functions (e.g., after inspecting with getCanvasJSON)
      if (secondMessage.tool_calls && secondMessage.tool_calls.length > 0) {
        console.log('API: AI made', secondMessage.tool_calls.length, 'more tool calls in second round');
        
        // Add second response to messages
        messages.push(secondMessage);

        // Execute these additional function calls
        for (const toolCall of secondMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;

          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          let functionResult;
          if (functionName === 'updateShapeProperties') {
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
          }

          // Add function results
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: functionResult || 'Success',
          });
        }

        // Make third call to get final response
        const thirdCompletion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages,
        });

        const finalMessage = thirdCompletion.choices[0].message;

        console.log('API: Returning response with', actionFunctionCalls.length, 'function calls (after 2 rounds)');
        console.log('API: Function calls:', JSON.stringify(actionFunctionCalls, null, 2));

        return NextResponse.json({
          message: finalMessage.content || 'I\'ve processed your request.',
          functionCalls: actionFunctionCalls,
        });
      }

      // No more function calls, return the message
      const finalMessage = secondMessage;

      console.log('API: Returning response with', actionFunctionCalls.length, 'function calls');
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

