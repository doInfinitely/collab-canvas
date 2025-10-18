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
    const systemMessage = `You are an AI assistant that helps users control a collaborative canvas. 
Current canvas state:
- Center position: (${canvasState?.centerX ?? 0}, ${canvasState?.centerY ?? 0})
- Zoom scale: ${canvasState?.scale ?? 1}
- Viewport dimensions: ${canvasState?.viewportWidth ?? 0}x${canvasState?.viewportHeight ?? 0}
- Selected shapes: ${selectedShapeIds?.length ?? 0} shape(s) selected
- Active users: ${userCursors?.length ?? 0} user(s) on canvas

You can help users navigate the canvas, inspect the canvas state, view selections, and see where other users are located.
World coordinates are in pixels where (0,0) is the origin.`;

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
          description: 'Get the complete canvas state as JSON, including all shapes with their properties (position, size, color, etc.)',
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
          description: 'Get the IDs of all currently selected shapes on the canvas',
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
    ];

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
    });

    const responseMessage = completion.choices[0].message;

    // Check if AI wants to call functions
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
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
          functionResult = JSON.stringify({ selectedIds: selectedShapeIds });
        } else if (functionName === 'getAllUserCursors') {
          functionResult = JSON.stringify({ users: userCursors });
        } else if (functionName === 'panToCoordinate') {
          // For action functions, just acknowledge
          functionResult = JSON.stringify({ success: true, x: args.x, y: args.y });
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

      // Make second call to get AI's natural language response
      const secondCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
      });

      const finalMessage = secondCompletion.choices[0].message;

      return NextResponse.json({
        message: finalMessage.content || 'I\'ve processed your request.',
        functionCalls: actionFunctionCalls,
      });
    }

    // No function calls, just return the message
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

