# AI Shape Manipulation Guide

## Quick Reference

The AI Assistant can now fully manipulate shapes on the canvas. Here's everything you can do:

### 🎯 Quick Commands

| What you want | Example command |
|--------------|-----------------|
| **Move a shape** | "Move BigCircle to 500, 300" |
| **Resize** | "Make the selected shape 200 pixels wide" |
| **Change colors** | "Make it red" or "Change stroke to blue" |
| **Change shape type** | "Turn this into a circle" |
| **Rename** | "Rename it to BlueSquare" |
| **Add notes** | "Add a note: needs review" |
| **Select shapes** | "Select all circles" |
| **Multi-property** | "Make it bigger, red, and move it right" |

### 📋 Supported Properties

```typescript
{
  x: number,              // Horizontal position
  y: number,              // Vertical position
  width: number,          // Width in pixels
  height: number,         // Height in pixels
  sides: number,          // 0=circle, 3=triangle, 4=rectangle, 5+=polygon
  z: number,              // Z-index (layering)
  stroke: string,         // Outline color (#RRGGBB)
  fill: string | null,    // Fill color (#RRGGBB) or null for transparent
  text_color: string,     // Text color (#RRGGBB)
  text_md: string,        // Text content
}
```

### 🎨 Color Format

All colors must be in **hex format**:
- ✅ `#ff0000` (red)
- ✅ `#00ff00` (green)  
- ✅ `#0000ff` (blue)
- ❌ `red` (not supported)
- ❌ `rgb(255,0,0)` (not supported)

The AI will convert color names to hex automatically.

### 📛 Naming Rules

Shape names must follow the **AdjectiveNoun** format:
- ✅ `BigCircle`
- ✅ `RedSquare`
- ✅ `SmallTriangle`
- ❌ `big circle` (wrong format)
- ❌ `Circle1` (must be adjective + noun)
- ❌ `BlueOctopus` (octopus not in noun list)

**Wordlists:** 
- Adjectives: `/public/names/adjectives.txt`
- Nouns: `/public/names/nouns.txt`

### 🔍 How the AI Works

#### Pattern 1: Direct Commands
```
User: "Move BigCircle to 500, 300"
→ AI finds BigCircle in canvas
→ Updates its position
→ Responds with confirmation
```

#### Pattern 2: Contextual Commands (using selection)
```
User: "Make it red"
→ AI calls getCurrentSelection()
→ Gets the selected shape details
→ Updates its fill color
→ Responds with confirmation
```

#### Pattern 3: Smart Selection
```
User: "Select all circles"
→ AI calls getCanvasJSON()
→ Filters for shapes with sides=0
→ Calls addToSelection with circle IDs
→ Responds with count
```

#### Pattern 4: Multi-step Operations
```
User: "Make BigCircle bigger, blue, and add a note"
→ AI finds BigCircle
→ Updates properties (width, height, fill)
→ Adds annotation
→ Responds with summary
```

### 🎭 Natural Language Examples

The AI understands natural variations:

**Position:**
- "Move it to 500, 300"
- "Put BigCircle at coordinates 100, 200"
- "Shift the selected shape 50 pixels right"

**Size:**
- "Make it bigger"
- "Resize to 200x150"
- "Double the width"
- "Make it smaller"

**Colors:**
- "Make it red"
- "Change the color to blue"
- "Set fill to #00ff00"
- "Remove the fill" (sets fill to null)

**Shape Type:**
- "Turn it into a circle"
- "Make it a triangle"
- "Change sides to 6" (hexagon)

**Selection:**
- "Select BigCircle"
- "Add RedSquare to selection"
- "Select all circles"
- "Deselect everything"

### ⚠️ Important Notes

1. **Shape Identification**: The AI can find shapes by:
   - Name (e.g., "BigCircle")
   - Current selection ("the selected shape")
   - Properties ("all circles", "all red shapes")
   - Position ("the shape at 500, 300")

2. **Validation**: 
   - Invalid shape IDs are rejected
   - Color formats are validated
   - Name format is strictly enforced
   - All changes are rolled back on errors

3. **Real-time Sync**:
   - All changes are broadcast to other users
   - Optimistic updates for instant feedback
   - Database persistence for reliability

4. **Selection Management**:
   - `addToSelection` adds to existing selection
   - `removeFromSelection` removes specific shapes
   - `clearSelection` deselects all

### 🚀 Advanced Usage

**Batch Operations:**
```
"Select all circles and make them red"
→ Selects all circles
→ Updates each one's color
→ Reports success
```

**Conditional Updates:**
```
"Make all shapes bigger than 100 pixels blue"
→ Finds matching shapes
→ Updates their colors
→ Reports count
```

**Relative Changes:**
```
"Move it 50 pixels to the right"
→ Gets current x position
→ Adds 50
→ Updates position
```

### 🔧 Troubleshooting

**"Shape not found"**
- Check the shape name spelling
- Try "What shapes are on the canvas?" first
- Make sure the shape exists

**"Name already taken"**
- Choose a different name
- Ask "What names are being used?"

**"Invalid format"**
- Ensure names follow AdjectiveNoun pattern
- Check that adjective/noun are in wordlists

**"Adjective not in list"**
- Use only adjectives from the wordlist
- Try a common adjective like "Big", "Small", "Red", etc.

### 💡 Tips

1. **Be specific**: "Move BigCircle to 500, 300" is clearer than "move it there"
2. **Use selection**: Select shapes first, then use "it" or "the selected shape"
3. **Check first**: Ask "What shapes are there?" before complex operations
4. **Combine operations**: "Make it bigger, blue, and move it right" works!
5. **Natural language**: The AI understands variations - don't worry about exact phrasing

### 🎓 Learning Examples

**Beginner:**
```
"What's on the canvas?"
"Select BigCircle"
"Make it red"
```

**Intermediate:**
```
"Move BigCircle to 500, 300 and make it bigger"
"Select all circles and change their color to blue"
"Rename the selected shape to RedSquare"
```

**Advanced:**
```
"Find all circles, make them 150 pixels wide, blue, and arrange them in a row"
"Select shapes with 'Big' in their name and move them to the top"
"For each selected shape, increase the size by 20% and add a note"
```

## Integration with Existing Features

The AI works seamlessly with:
- ✅ Real-time collaboration (changes sync to all users)
- ✅ Annotations system (adds notes via AI)
- ✅ Selection system (manages selection state)
- ✅ Undo/redo (changes are part of history)
- ✅ Version control (changes are saved in versions)

## API Summary

For developers integrating with the AI:

```typescript
// Read operations (no side effects)
getCanvasJSON() → string
getCurrentSelection() → { selectedIds, count, shapes }
getAllUserCursors() → { users, count }

// Write operations (modify canvas)
updateShapeProperties(shapeId, updates) → { success, error? }
renameShape(shapeId, newName) → { success, error? }
addAnnotation(shapeId, text) → { success, error? }

// Selection operations (modify UI state)
addToSelection(shapeIds) → { success, added }
removeFromSelection(shapeIds) → { success, removed }
clearSelection() → { success }

// Navigation (modify view)
panToCoordinate(x, y) → void
```

All write operations return `{ success: boolean, error?: string }` for error handling.

