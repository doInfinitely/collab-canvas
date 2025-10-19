# AI Development Log

This is my one-page breakdown documenting my AI-first development process.

## Tools and Workflow

For my Collab Canvas MVP I exclusively used ChatGPT 5 in the web interface.
No integration necessary, just a conversation with the AI. I continued with
this process, using Claude when ChatGPT5 struggled, and then switching back to
ChatGPT5 when I used up my quota with Anthropic. When I finally got to the AI
features I was starting to feel the limitation of the web browser approach and
I finally succumbed to the siren song of Cursor. My main Canvas component was
over 4000 lines at this point. From the requirements documents, which I imported
as Markdown and the codebase, Cursor was able to quickly implement my AI
features. Finally, at the end I spent a few hours with Cursor refactoring my 
massive monolithic component into separate files.

## Prompting Strategies

I started by converting the project requirements to markdown, and then I
envisioned a series of apps that I wanted each one building on the last. First,
the minimal authentication app, that merely lets users log in an out, then the
minimal "Presence App," that displayed which users are online and offline, and
finally richer and more feature complete versions of a the canvas app, first a
version that broadcasts the scroll offset and cursor offset to the presence
list, then adding shape creation/deletion, and finally the multiplayer cursors
as the icing on top.

One strategy that I used was I had ChatGPT5 write a python script to print the
contents of all the code files in my project along with their paths so that I
could quickly get a new instance of ChatGPT5 up to speed on my project.

## Refactoring Journey

The final phase of development involved a complete restructuring of the monolithic
CanvasViewport component. Starting at 4,303 lines, this single file contained all
canvas logic, event handlers, state management, and UI rendering.

**The Challenge**: The component had become unmaintainable. Adding features required
scrolling through thousands of lines, TypeScript compilation was slow, and the risk
of breaking existing functionality was high. Cursor identified this as the primary
technical debt.

**The Strategy**: We adopted an incremental, safety-first approach with three phases:

**Phase 1 - Pure Utilities (Low Risk)**  
Extracted computational functions with no state dependencies:
- `colors.ts` - Color conversion utilities (hex, RGB, HSV)
- `shapes.ts` - Shape geometry calculations
- `markdown.ts` - Markdown rendering for shape text
- `geometry.ts` - Hit testing and coordinate transformations

This reduced complexity without changing behavior, establishing confidence in the
refactoring approach.

**Phase 2 - Standalone Sub-Components (Moderate Risk)**  
Extracted self-contained UI pieces:
- `DebugHUD.tsx` - Debug overlay (108 lines)
- `MultiplayerCursors.tsx` - Remote cursor rendering (75 lines)
- `TextEditorOverlay.tsx` - In-place text editing (112 lines)
- `ColorPickerPopover.tsx` - HSV color picker (187 lines)
- `CanvasContextMenu.tsx` - Export/version menu (215 lines)
- `ShapeRenderer.tsx` - Individual shape rendering (156 lines)
- `ShapePropertiesModal.tsx` - Property editor (467 lines)

Each extraction was verified with build checks and manual testing before proceeding.

**Phase 3 - Custom Hooks (High Risk)**  
This was the most delicate phase, extracting stateful logic one hook at a time:

1. `useColorPicker` (58 lines) - Color picker state and recent colors
2. `usePresence` (168 lines) - Real-time user presence tracking
3. `useAnnotations` (334 lines) - Collaborative shape comments
4. `useCanvasVersioning` (354 lines) - Save/restore canvas state
5. `useKeyboardShortcuts` (148 lines) - Cmd+C/V/X, debug shortcuts
6. `usePanZoom` (180 lines) - Camera control and viewport
7. `useAIHelpers` (159 lines) - AI utility functions
8. `useShapeOperations` (498 lines) - Shape CRUD for AI
9. `useDataLoading` (58 lines) - Initial wordlist and shape loading
10. `useShapeCRUD` (296 lines) - Core shape manipulation
11. `useMouseInteraction` (430 lines) - All mouse/drag handlers

**Critical Moments**: The first refactoring attempt broke the canvas entirely - zoom
was wrong, interactions showed error screens, AI features froze. We reverted completely
and redesigned the approach to be more incremental. Git commits after each successful
extraction provided rollback points.

**Type Safety Victory**: The refactoring exposed widespread use of `any` types that
masked potential bugs. We created `src/types/canvas.ts` with proper type definitions,
eliminating all `any` usages. This caught several type mismatches that would have been
runtime errors.

**Final Metrics**:
- CanvasViewport.tsx: 4,303 → 1,394 lines (67% reduction)
- Total extracted code: 2,683 lines across 11 hooks
- Sub-components: 1,320 lines across 7 files
- Utility modules: 400+ lines across 4 files
- Build time: Improved due to more granular compilation
- Maintainability: Each concern now isolated and testable

The refactoring took approximately 3-4 hours with Cursor, involving ~200 tool
invocations. The AI handled dependency tracking, type inference, and caught integration
bugs that would have been difficult to spot manually.

## Code Analysis

More than 99% of the code was AI-generated. I merely played the orchestration
role, connecting apps, directing progress, and testing.

**Technology Stack**:
- Next.js 15.5.5 (with Turbopack for fast builds)
- React 19 (Server Components where appropriate)
- TypeScript (strict mode)
- Supabase (PostgreSQL + Real-time subscriptions)
- Tailwind CSS for styling
- SVG for canvas rendering

**Project Structure**:
```
src/
├── app/                    # Next.js App Router
│   ├── api/ai-chat/       # AI agent endpoint
│   ├── canvas/            # Canvas page
│   └── dashboard/         # User dashboard
├── components/
│   ├── canvas/            # 7 canvas sub-components (1,320 lines)
│   ├── CanvasViewport.tsx # Main canvas (1,394 lines)
│   └── ChatBox.tsx        # AI chat interface (567 lines)
├── hooks/canvas/          # 11 custom hooks (2,683 lines)
├── lib/
│   ├── canvas/            # 4 utility modules (400+ lines)
│   └── supabase/          # Database client
└── types/
    └── canvas.ts          # Shared type definitions
```

**Key Architectural Decisions**:

*Real-time Synchronization*: Used Supabase Realtime channels with a hybrid approach:
- Broadcast for instant updates (cursor positions, shape moves)
- Database writes for persistence (shape creation, text edits)
- Optimistic updates in React state before database confirmation
- Last-write-wins conflict resolution (timestamps on all mutations)

*State Management*: Custom hooks pattern rather than Redux/Zustand:
- Local state via useState for UI concerns
- Refs (useRef) for values needed in callbacks without re-renders
- Custom hooks to encapsulate related state and side effects
- No global state store - prop drilling through React context where needed

*Component Composition*: 
- Presentational components receive props, no business logic
- Container component (CanvasViewport) orchestrates hooks
- Portal-based overlays for modals and popovers
- SVG elements for canvas shapes (transform-based positioning)

**Lines of Code Breakdown**:
- Total application: ~8,000 lines
- Main canvas logic: 5,400 lines (component + hooks + utilities)
- AI integration: 1,312 lines (chat API route)
- Authentication/infrastructure: ~800 lines
- UI components: ~500 lines

## Technical Architecture Insights

**The Canvas Coordinate System**:
One of the more complex aspects was managing multiple coordinate spaces:
- Screen coordinates (mouse events)
- World coordinates (logical canvas space)
- Local coordinates (relative to shape center, accounting for rotation)

The AI correctly implemented the transformation math, but debugging coordinate
issues required multiple iterations. The breakthrough came when Cursor extracted
the geometry utilities into a dedicated module where the transformations could be
reasoned about independently.

**Real-time Edge Cases**:
- Stale closure problem: Event handlers capturing old state values
  - Solution: useRef for latest values, callbacks regenerated on dependency changes
- Race conditions: Multiple users editing the same shape simultaneously
  - Solution: Optimistic updates + timestamp-based conflict resolution
- Connection loss: Users going offline mid-edit
  - Solution: Supabase handles reconnection, missed broadcasts caught by periodic polling

**Type Safety Journey**:
The initial codebase used `any` liberally for speed. The refactoring revealed this
as technical debt:
- 13 instances of `type Shape = any;` across hooks
- Multiple `React.RefObject<any>` that masked type mismatches
- Function parameters typed as `any` losing type inference

Creating `src/types/canvas.ts` with proper shared types eliminated these issues.
The TypeScript compiler then caught several bugs:
- Missing null checks on optional properties
- Incorrect return types from async functions
- Incompatible Map types being passed between hooks

The AI (Cursor) handled most of the type migration automatically, but required
guidance on which types to use for Supabase Realtime channels.

**Performance Considerations**:
- RAF-based batching for drag operations (avoid excessive DB writes)
- Optimistic UI updates (don't wait for database round-trip)
- Z-index sorting only on shape array change (useMemo)
- Render shape text only when visible (conditional markdown parsing)
- Supabase broadcast channels (faster than database polling)

These weren't initially implemented - they came from Cursor suggesting optimizations
when the canvas started feeling sluggish during testing.

## Strengths and Limitations

I found that getting the minimal viable authentication app enabling Github and
email magic link was especially finicky. After many promptings it started
working and I was afraid to touch that code again for fear of breaking it.
Later on in the process, the LLM suggested changes to make the authentication
"more robust" and that completely bricked the authentication and I had to
revert the changes.

I also had a big issue with broadcasting the cursor position and getting the dot
grid to show up that took hours of prompting to resolve. I honestly wished I had
more exposure to React so I could surgically fix the issue but with
perseverance I eventually got the LLM to fix the issue.

I also found that as the context window filled for the ChatGPT5 instance the
website got slow and unwieldy, two times I had to start a new chat to clear
out all the context. ChatGPT5 would often get unstuck with debugging a problem
if it "sees it with fresh eyes." That is, I would start a new instance, provide
it the project requirements, all my code so far, and directives regarding the
last thing I was trying to accomplish and the new instance would often spot the
mistake of the old instance.

I really was surprised that ChatGPT5 couldn't one-shot authentication, I
expected something like that would be well represented in its corpus, but alas.

The web-UI based approach led me to be more entangled with the code, but of
course it was slower as I had to manually integrate the changes after each
round of conversation. It also kept my Cursor usage low (although I'm sure
Open AI was feeling the pain) for the majority of the project. But moving to
Cursor let the project really fly! The AI features were a breeze to implement,
even if I was less aware of the contents of the project.

**Refactoring-Specific Observations**:

*What Worked Exceptionally Well*:
- Incremental approach with rollback points (Git commits after each success)
- Starting with low-risk extractions (utilities) to build confidence
- Type errors caught at build time, not runtime
- Cursor's ability to track dependencies across files
- Parallel tool invocations for reading multiple files simultaneously

*Build System as Safety Net*:
The strictness of TypeScript + ESLint saved us multiple times:
- `@typescript-eslint/no-explicit-any` caught all loose typing
- Missing imports detected immediately
- Hook dependency warnings prevented stale closure bugs
- Vercel's build process caught issues before deployment

*Where AI Struggled*:
- Initial attempt at "big refactor" failed completely - too many moving parts
- Variable declaration order caused linter errors (hooks called before dependencies)
- Type mismatches between component and hook definitions required iteration
- SSR compatibility issues (`sessionStorage` access during server render)

*The Human Role*:
Even with Cursor doing the heavy lifting, I provided:
- Strategic direction (which extraction next, what the priorities were)
- Testing and verification (checking the UI still worked)
- Rollback decisions (when to revert vs. fix forward)
- Architecture guidance (choosing hooks over state management libraries)

The AI wrote the code, but I orchestrated the safety-first approach that made the
refactoring successful.

## AI Agent Implementation Insights

After the refactoring, I implemented an AI agent that could control the canvas through
natural language. This involved using OpenAI's GPT-4o with function calling to manipulate
shapes, manage selections, and reason about spatial relationships. This phase revealed
unique challenges about teaching LLMs to work with large datasets and complex state.

**The Multi-Round Function Calling Evolution**:
Initially, the AI agent was limited to 2 rounds of function calls. When asked to "create
400 circles in a grid," it would create ~20 shapes, then stop. The solution had two parts:
- Implemented a `while` loop with `MAX_ROUNDS = 50` for truly complex operations
- Created batch operations (`createShapes`, `updateShapesProperties`, `addAnnotations`)

The batch approach was more elegant: instead of 400 individual function calls across many
rounds, it became 2 rounds (get viewport → create all 400 shapes in one call). This
pattern—giving the AI tools that operate on arrays—proved essential for performance.

**The Database Type Mismatch**:
An interesting bug emerged where the AI computed coordinates as precise floats
(`4381.362092008296`), but PostgreSQL expected integers. The AI reasons mathematically,
producing exact values, but databases have constraints. Solution: `Math.round()` everywhere
numeric values are sent to the database. This highlighted a common pattern: AI-generated
values often need explicit coercion for system boundaries.

**Teaching Spatial Reasoning Through Explicit Algorithms**:
When I asked "find all shapes touching BigShape," the AI initially found only 3 out of
400+ shapes. Rather than building a specialized collision detection function, I enhanced
the system prompt with:
- The exact rectangle intersection formula (A.x < B.x + B.width AND...)
- Step-by-step algorithmic guidance
- Emphasis on checking ALL shapes, not sampling
- Concrete examples showing iteration over 400 shapes

This worked perfectly. **Key insight**: LLMs can reason about properties you haven't
hardcoded functions for, but they need explicit mathematical/algorithmic guidance in
the prompt. Don't write specialized functions for every query type—teach the AI the
underlying algorithm once.

**The Logging Strategy for Distributed Debugging**:
When tracking down "No valid shapes found" errors, I added `console.log` statements at
every layer:
- API route: What IDs is the AI computing and sending?
- ChatBox: What arguments are being passed to the function?
- CanvasViewport: What IDs were received vs. what exists in state?

This revealed the AI was computing correct IDs, but there was a state synchronization
issue. The pattern: log inputs at component boundaries, compare expectations vs. reality
at each step. Essential for debugging function calling across multiple layers.

**Conversation Memory and Stateless APIs**:
The AI initially had amnesia—when I said "continue creating shapes," it had no context
of the previous request. The fix was straightforward: send `messageHistory` with each
request so the AI can see its own previous messages. **Critical lesson**: Stateless APIs
need explicit context management. The AI can't remember unless you feed it its own history.

**The "Direct Path" Optimization Pattern**:
Instead of making the AI:
1. Call `getCurrentSelection()` to get [id1, id2, id3]
2. Call `updateShapesProperties([id1, id2, id3], updates)`

I added `updateSelectionProperties(updates)` that operates directly on the selection.
This is the "don't make the AI echo data back" principle—if you already know what the
AI wants to operate on (the selection), provide a direct path. Reduced 2 calls to 1,
and eliminated unnecessary data transfer.

**Prompt Engineering as Iterative Development**:
The system prompt evolved through 5+ major iterations:
1. Initial: Basic tool descriptions
2. Added: Batching emphasis with examples
3. Added: Spatial reasoning section with formulas  
4. Added: Large dataset handling guidelines
5. Added: Annotation reading capabilities

Each iteration was driven by observing where the AI struggled. The prompt transformed
from "here are tools" into "here's how to think about the problem, here's the math you
need, here are common patterns." The best prompts teach problem-solving approaches,
not just enumerate functions.

**The Missing Read Operations Pattern**:
I had `addAnnotation` but forgot `getAnnotations`. A recurring pattern: write operations
are obvious to implement, but read/query operations are easy to forget. **The AI agent
needs comprehensive read access to reason about state before taking actions.** Every
write operation should have a corresponding read operation, often with filtering
capabilities (by shape, by user, by timeframe, etc.).

**Integer Rounding Everywhere**:
After the coordinate bug, I added `Math.round()` not just in `createShape`, but in
`updateShapeProperties` and every function that touched numeric fields. This defensive
programming pattern—coerce at the boundary—prevented an entire class of bugs. When
working with AI-generated values going into typed systems, explicit coercion is safer
than relying on implicit conversion.

**The 128 Tool Call Limit**:
OpenAI limits function calling to 128 tools per message. When the AI tried to delete
400+ shapes by calling `deleteShapes([id])` 400 times individually, it hit this limit.
The fix: update the prompt to emphasize batching, and improve tool descriptions to
say "ALWAYS pass ALL IDs in a single call." The AI needed explicit guidance that the
limit existed and how to work within it.

## Key Takeaways for Future Projects

1. **Start with structure**: If I had known the final architecture upfront, building
   incrementally with proper separation would have been faster than the monolith-then-refactor
   approach.

2. **Type safety from day one**: The `any` types that accelerated initial development
   became debt. Strict TypeScript from the start would have prevented the migration pain.

3. **Git discipline**: Frequent commits with clear messages provided confidence to try
   risky refactorings. Every successful extraction was a commit.

4. **Test before next step**: After each hook extraction, I verified the canvas still
   worked before proceeding. This isolated problems to the most recent change.

5. **Cursor for refactoring**: The integrated IDE approach excels at large-scale code
   movement. Web UI ChatGPT is better for architecture discussions and planning.

6. **Real-time is hard**: The Supabase channels, broadcast events, and optimistic updates
   were the most complex part to get right. AI struggled here initially, suggesting
   approaches that had race conditions.

7. **Fresh context helps**: When stuck, starting a new Cursor session with the problem
   statement often led to breakthroughs. The AI "saw it with fresh eyes."

I'm excited for the next project!
