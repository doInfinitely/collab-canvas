# Multi-Round Function Calling Implementation

## Problem
Currently the AI can only make 2 rounds of function calls:
1. First completion: Initial tool calls (like getCanvasJSON)
2. Second completion: Additional tool calls after seeing results (like updateShapeProperties)
3. Third completion: Natural language response

For complex commands like "Make 400 shapes in a grid", the AI needs unlimited rounds.

## Solution
Wrap the second completion logic in a while loop that continues until the AI stops requesting tool calls.

## Code Change Required

In `/src/app/api/ai-chat/route.ts`, replace this section (starting around line 700):

```typescript
// Make second call - AI might call MORE functions after seeing the results
const secondCompletion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages,
  tools,
  tool_choice: 'auto',
});

const secondMessage = secondCompletion.choices[0].message;

// Check if AI wants to call MORE functions
if (secondMessage.tool_calls && secondMessage.tool_calls.length > 0) {
  // ... execute tool calls ...
  
  // Make third call to get final response
  const thirdCompletion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
  });
  
  const finalMessage = thirdCompletion.choices[0].message;
  
  return NextResponse.json({
    message: finalMessage.content || 'I\'ve processed your request.',
    functionCalls: actionFunctionCalls,
  });
}

// No more function calls, return the message
const finalMessage = secondMessage;
```

**With this:**

```typescript
// Continue making calls until AI stops requesting tool calls
let roundNumber = 2;
const MAX_ROUNDS = 10; // Safety limit to prevent infinite loops
let continueLoop = true;

while (continueLoop && roundNumber <= MAX_ROUNDS) {
  const nextCompletion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    tools,
    tool_choice: 'auto',
  });

  const nextMessage = nextCompletion.choices[0].message;

  if (nextMessage.tool_calls && nextMessage.tool_calls.length > 0) {
    console.log(`API: AI made ${nextMessage.tool_calls.length} more tool calls in round ${roundNumber}`);
    
    // Add response to messages
    messages.push(nextMessage);

    // Execute these additional function calls (keep existing logic)
    for (const toolCall of nextMessage.tool_calls) {
      // ... all the existing tool call handling code ...
      // (same as before, just change secondMessage references to nextMessage)
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

return NextResponse.json({
  message: finalMessage.content || 'I\'ve processed your request.',
  functionCalls: actionFunctionCalls,
});
```

## Key Changes:
1. **Add loop variables** before the second completion
2. **Replace `secondMessage` with `nextMessage`** in the loop
3. **Remove third completion** from inside the if block
4. **Add else block** to exit loop when no tool calls
5. **Increment `roundNumber`** at end of each iteration
6. **Make final completion** after loop ends
7. **Update logging** to show actual rounds completed

## Testing
After implementing, test with:
- "Make 400 shapes in a 20x20 grid within the current viewport"
- "Create 10 circles, then arrange them in a line, then zoom to fit them all"

The AI should now be able to make as many rounds of function calls as needed (up to MAX_ROUNDS).

## Safety
- `MAX_ROUNDS = 10` prevents infinite loops
- Each round is logged for debugging
- Loop exits cleanly when AI finishes calling tools

