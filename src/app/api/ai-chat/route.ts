import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, canvasState } = body;

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

You can help users navigate the canvas by panning to specific coordinates.
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
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: message },
      ],
      tools,
      tool_choice: 'auto',
    });

    const responseMessage = completion.choices[0].message;

    // Extract function calls if any
    const functionCalls = responseMessage.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments),
    })) ?? [];

    return NextResponse.json({
      message: responseMessage.content || '',
      functionCalls,
    });
  } catch (error) {
    console.error('AI Chat API Error:', error);
    return NextResponse.json(
      { error: 'Failed to process AI request' },
      { status: 500 }
    );
  }
}

