# CollabCanvas Requirements Met - Demonstration Guide

This document provides concrete instructions for demonstrating each implemented feature from the requirements rubric. For each feature, we detail exactly what to do and what you should observe.

---

## Section 2: Canvas Features & Performance (20 points)

### Canvas Functionality (8 points)

#### 1. **Smooth Pan/Zoom**
- **How to demonstrate**: 
  - Hold the right mouse button and drag on the background to pan
  - Use scroll wheel or trackpad pinch to zoom in/out
- **Expected result**: Canvas moves smoothly without lag or stuttering

#### 2. **3+ Shape Types**
- **How to demonstrate**: 
  - Create a shape (initially it will be a rectangle, 4 sides)
  - Right-click on the shape to open the Shape Properties Modal
  - In the "Geometry" section, change the "Number of sides" field
  - Enter 0 for ellipse/circle, 3 for triangle, 5 for pentagon, 6 for hexagon, etc.
  - Click "Save sides"
- **Expected result**: The shape transforms into the requested polygon type (ellipses, triangles, pentagons, hexagons, etc.)

#### 3. **Text with Formatting**
- **How to demonstrate**: 
  - Create any shape (polygon or ellipse)
  - Click inside the shape to begin editing text
  - Type your text - it supports markdown formatting:
    - `**bold**` or `__bold__` for **bold** text
    - `*italic*` or `_italic_` for *italic* text
    - `` `code` `` for `code` formatting
  - Click outside the shape to finish editing
- **Expected result**: Text appears within the shape with markdown formatting applied. Text size adjusts automatically based on zoom level.

#### 4. **Multi-select (shift-click or drag)**
- **How to demonstrate**: 
  - Create multiple shapes on the canvas
  - Hold Shift and click on multiple shapes
  - Alternatively, click and drag to create a selection box around multiple shapes
- **Expected result**: Multiple shapes are selected simultaneously (shown by selection handles)

#### 5. **Layer Management**
- **How to demonstrate**: 
  - Create multiple overlapping shapes
  - Right-click on a shape to open Shape Properties Modal
  - In the "Layering" section, use "Send to front" or "Send to back" buttons
  - Or enter a specific z-index value and click "Set Z"
- **Expected result**: Z-index of shapes can be controlled

#### 6. **Transform Operations (move/resize/rotate)**
- **Move**: 
  - Click and drag any shape to move it
  - Expected result: Shape moves to new position
- **Resize**: 
  - Select a shape to see its perimeter
  - Drag on the perimeter (edges) to resize
  - Expected result: Shape changes size
- **Rotate**: 
  - Select a shape
  - Hold Cmd (Mac) or Ctrl (Windows) and drag on a corner of the shape's perimeter
  - Expected result: Shape rotates around its center

#### 7. **Duplicate/Delete**
- **Duplicate**: 
  - Select one or more shapes
  - Press Cmd+C (Mac) or Ctrl+C (Windows) to copy
  - Press Cmd+V (Mac) or Ctrl+V (Windows) to paste
  - Expected result: A copy of the shape(s) appears at a slightly offset position
- **Delete**: 
  - Double-click on a shape to delete it
  - If multiple shapes are selected, double-clicking any selected shape will delete all selected shapes
  - Expected result: Shape(s) removed from canvas

### Performance & Scalability (12 points)

#### Testing with 100+ Objects
- **How to demonstrate**: 
  - Use the AI chat: "Create a 10x10 grid of rectangles"
  - This will create 100 objects
  - Try panning, zooming, and selecting objects
- **Expected result**: Canvas remains responsive with 100+ objects

#### Testing with Multiple Concurrent Users
- **How to demonstrate**: 
  - Open the canvas in 2-3 different browser windows/tabs (or different devices)
  - Login with different accounts in each window
  - Perform actions (create, move, delete shapes) in different windows
  - Check the "Presence List" to see other connected users
- **Expected result**: 
  - All users see each other in the presence list
  - Changes from one user appear in real-time for all other users
  - System handles 2-3+ concurrent users without issues

---

## Section 3: Advanced Figma-Inspired Features (15 points)

### Summary of Implemented Features

**Tier 1 Features (3 implemented = 6 points):**
1. Copy/Paste with Keyboard Shortcuts (Cmd/Ctrl + C/V/X)
2. Debug HUD Toggle (? or Shift+/)
3. Right-Click Context Menus (Shape Properties and Canvas Menu)

**Tier 2 Features (2 implemented = 6 points):**
4. Z-index Management (send to front/back, set specific z-index)
5. Canvas Versioning System (save and restore canvas states)

**Tier 3 Features (1 implemented = 3 points):**
6. Collaborative Comments/Annotations on Objects

**Total: 15 points** (3 Tier 1 + 2 Tier 2 + 1 Tier 3 = Excellent rating)

---

### Tier 1 Features Implemented

#### 1. **Copy/Paste with Keyboard Shortcuts** (2 points)
- **How to demonstrate**: 
  - Create several shapes
  - Select one or more shapes
  - Press Cmd+C (Mac) or Ctrl+C (Windows) to copy
  - Press Cmd+V (Mac) or Ctrl+V (Windows) to paste
  - Press Cmd+X (Mac) or Ctrl+X (Windows) to cut
- **Expected result**: Shapes are copied/pasted/cut successfully

#### 2. **Debug HUD Toggle** (2 points)
- **How to demonstrate**: 
  - Press `?` or `Shift+/` to toggle the debug heads-up display
  - The HUD shows detailed information about the canvas state, viewport, and controls
  - Press `?` again to hide it
- **Expected result**: Debug HUD toggles on/off showing canvas diagnostics

#### 3. **Right-Click Context Menu** (2 points)
- **How to demonstrate**: 
  - Right-click on a shape to open the Shape Properties Modal
  - Right-click on the background to open the Canvas Menu with options for:
    - Versions tab: Save and restore canvas versions
    - Annotations tab: View all annotations
    - Export tab: Export canvas as PNG, SVG, or JSON
- **Expected result**: Context-appropriate menus provide access to advanced features

### Tier 2 Features Implemented

#### 4. **Z-index Management (bring to front, send to back)** (3 points)
- **How to demonstrate**: 
  - Create 2-3 overlapping shapes
  - Right-click on a shape to open Shape Properties Modal
  - In the "Layering" section, click "Send to front" or "Send to back"
  - Or enter a specific z-index value and click "Set Z"
  - If multiple shapes are selected, the z-index change applies to all selected shapes
- **Expected result**: The z-order of the selected shape(s) changes

#### 5. **Canvas Versioning System** (3 points)
- **How to demonstrate**: 
  - Create several shapes on the canvas
  - Right-click on the background to open Canvas Menu
  - Go to the "Versions" tab
  - Click "Save Current State" to create a version snapshot
  - Make more changes to the canvas
  - Go back to Versions tab and click "Restore" on a previous version
  - You can also use the AI: "Save the current canvas state" or "Restore to the last version"
- **Expected result**: Canvas state can be saved and restored, with timestamps and user info displayed

### Tier 3 Features Implemented

#### 6. **Collaborative Comments/Annotations on Objects** (3 points)
- **How to demonstrate**: 
  - Create a shape on the canvas
  - Right-click on the shape to open Shape Properties Modal
  - Scroll down to the "Annotations" section at the bottom
  - Type a comment/note in the text area and click "Add annotation"
  - Your annotation appears with your email and timestamp
  - Other users can also add annotations to the same shape
  - View all annotations by right-clicking background → Canvas Menu → Annotations tab
  - You can also use the AI: "Add an annotation to this shape saying 'needs review'" or "Show me all annotations"
- **Expected result**: Users can leave comments/notes on shapes that are visible to all collaborators

---

## Section 4: AI Canvas Agent (25 points)

### AI Command Categories

The AI agent can be accessed through the chat interface on the canvas page. Simply type natural language commands, and the AI will interpret and execute them on the canvas.

#### Creation Commands (At least 2 required)

**1. Basic Shape Creation**
- **Example commands to try**:
  - "Create a red circle at position 100, 200"
  - "Add a blue rectangle"
  - "Make a 200x300 rectangle"
  - "Create a green circle"
- **Expected result**: The specified shape is created on the canvas with the requested properties

**2. Text Creation**
- **Example commands to try**:
  - "Add a rectangle that says 'Hello World'"
  - "Create a circle with text 'Welcome'"
  - "Add a hexagon that says 'My Canvas'"
- **Expected result**: A shape is created with the specified text content

**3. Multiple Object Creation**
- **Example commands to try**:
  - "Create 5 circles"
  - "Make 3 rectangles"
  - "Add 10 squares"
- **Expected result**: Multiple instances of the specified shape are created

#### Manipulation Commands (At least 2 required)

**1. Move Objects**
- **Example commands to try**:
  - "Move the blue rectangle to the center"
  - "Move the circle to position 300, 400"
  - "Move the text to the top left"
- **Expected result**: The specified object moves to the requested position

**2. Resize Objects**
- **Example commands to try**:
  - "Resize the circle to be twice as big"
  - "Make the rectangle bigger"
  - "Scale the blue square to 200x200"
- **Expected result**: The specified object changes size

**3. Change Properties**
- **Example commands to try**:
  - "Make the rectangle red"
  - "Change the circle's fill color to blue"
  - "Set the text color of the hexagon to green"
  - "Change the stroke width of all shapes to 3"
- **Expected result**: The specified object's properties are updated

**4. Rotate Objects**
- **Example commands to try**:
  - "Rotate the rectangle 45 degrees"
  - "Rotate the hexagon 90 degrees"
- **Expected result**: The specified object rotates by the requested angle

**5. Delete Objects**
- **Example commands to try**:
  - "Delete the red rectangle"
  - "Remove all circles"
  - "Delete everything"
- **Expected result**: The specified objects are removed from the canvas

#### Layout Commands (At least 1 required)

**1. Arrange in Rows**
- **Example commands to try**:
  - "Arrange these shapes in a horizontal row"
  - "Line up the rectangles horizontally"
- **Expected result**: Selected or specified shapes are arranged in a horizontal line

**2. Create Grids**
- **Example commands to try**:
  - "Create a grid of 3x3 squares"
  - "Make a 4x4 grid of circles"
  - "Create a 10x10 grid of rectangles"
- **Expected result**: A grid of shapes is created with the specified dimensions

**3. Spacing and Distribution**
- **Example commands to try**:
  - "Space these elements evenly"
  - "Distribute the rectangles horizontally"
- **Expected result**: The specified objects are evenly spaced

#### Complex Commands (At least 1 required)

**1. Multi-Step Shape Compositions**
- **Example commands to try**:
  - "Create a house shape using a rectangle and a triangle on top"
  - "Make a simple face with a circle for the head and smaller circles for eyes"
  - "Create a traffic light with 3 circles stacked vertically in a rectangle"
- **Expected result**: Multiple coordinated shapes are created and arranged to form the requested composition

**2. Conditional Selections and Transformations**
- **Example commands to try**:
  - "Create 10 rectangles numbered 1 to 10"
  - Then: "Make the rectangles with even numbers blue"
  - Or: "Turn the rectangles that contain prime numbers in their text to ovals"
- **Expected result**: The AI selects the appropriate objects based on the condition and applies the transformation

**3. Gradual Color Transitions**
- **Example commands to try**:
  - "Make 10 rectangles in a horizontal line equispaced, the left one should be blue, the right one should be green, and the remainder should be a gradation between the two end colors"
- **Expected result**: 10 rectangles are created in a line with colors gradually transitioning from blue to green

**4. Batch Operations**
- **Example commands to try**:
  - "Create 5 circles and make them all different colors"
  - "Make 20 rectangles in random positions with random colors"
- **Expected result**: Multiple objects are created with varying properties

### Complex Command Execution - Additional Examples

The AI can handle arbitrarily complex commands as long as they're within the space of possible user inputs. Here are more examples:

#### Numeric and Mathematical Operations
- "Create 15 squares and number them from 1 to 15"
- "Make all shapes with even numbers red and odd numbers blue"
- "Create rectangles with widths that are multiples of 50 (50, 100, 150, 200)"

#### Conditional Formatting
- "Find all red shapes and make them twice as big"
- "Take all circles and arrange them in a vertical column"
- "Select all hexagons and change their fill color to purple"

#### Complex Arrangements
- "Create a pyramid of circles: 1 at top, then 2, then 3, then 4 rows"
- "Make a rainbow using 7 rectangles in a row with ROYGBIV colors"
- "Create a checkerboard pattern with 8x8 squares alternating black and white"

#### Multi-Step Compositions
- "Create a solar system with a large yellow circle for the sun and smaller circles orbiting around it"
- "Make a bar chart with 5 rectangles of different heights arranged horizontally"
- "Design a flower with a center circle and 6 ellipses arranged as petals around it"

### How to Test Complex Command Capabilities

1. **Start Simple**: Begin with basic commands to ensure the AI is working
2. **Increase Complexity**: Try commands that involve multiple steps
3. **Test Conditional Logic**: Use commands that require selection based on properties
4. **Verify Multi-Object Operations**: Commands that affect multiple objects at once
5. **Check Mathematical Processing**: Commands involving calculations or numerical patterns

---

## Multi-User Collaboration Features

### Real-Time Presence
- **How to demonstrate**: 
  - Open the canvas in multiple browser windows with different accounts
  - Look at the "Presence List" in the interface
- **Expected result**: All connected users are visible in the presence list with their names/colors

### Real-Time Cursor Tracking
- **How to demonstrate**: 
  - With multiple users connected, move your cursor on the canvas
  - Watch the other browser windows
- **Expected result**: Each user's cursor is visible to other users in real-time with their name/color

### Real-Time Object Synchronization
- **How to demonstrate**: 
  - With multiple users connected, create, move, or modify objects in one window
  - Watch the other browser windows
- **Expected result**: Changes appear immediately in all connected windows

### Concurrent AI Usage
- **How to demonstrate**: 
  - Open the canvas with multiple users
  - Have different users issue AI commands simultaneously
- **Expected result**: Both AI commands execute and all users see both sets of changes

---

## Quick Start Testing Script

To quickly verify core functionality, follow this testing sequence:

1. **Login and Access Canvas**
   - Go to the app and login
   - Navigate to the canvas page

2. **Test Basic Shape Creation** (30 seconds)
   - Click on the canvas to create a rectangle
   - Right-click it, open Properties, change sides to 0 (circle), click "Save sides"
   - Create another shape and change it to a hexagon (6 sides)
   - Click inside a shape and type some text

3. **Test Manipulation** (30 seconds)
   - Move shapes by dragging
   - Drag on the perimeter to resize
   - Double-click a shape to delete it

4. **Test Multi-Select** (20 seconds)
   - Create 3 shapes
   - Hold Shift and click to select all 3
   - Move them together

5. **Test AI - Creation** (1 minute)
   - Open chat and type: "Create 5 blue circles"
   - Type: "Add a rectangle that says 'Hello World'"

6. **Test AI - Manipulation** (1 minute)
   - Type: "Make all circles red"
   - Type: "Arrange the circles in a horizontal line"

7. **Test AI - Complex Command** (1 minute)
   - Type: "Create a 5x5 grid of squares"
   - Type: "Make a gradient from red on the left to blue on the right using 10 rectangles"

8. **Test Collaboration** (2 minutes)
   - Open a second browser window with a different account
   - Create a shape in one window
   - Verify it appears in the other window
   - Check that cursors are visible across windows

9. **Test Copy/Paste** (30 seconds)
   - Create or select some shapes
   - Press Cmd+C (or Ctrl+C) to copy
   - Press Cmd+V (or Ctrl+V) to paste
   - Verify the copied shapes appear

10. **Test Performance** (1 minute)
    - Type in AI chat: "Create a 10x10 grid of rectangles"
    - Pan and zoom around the 100 objects
    - Verify smooth performance

**Total time**: ~8 minutes for comprehensive feature verification

---

## Notes for Graders

- All features listed above are implemented and functional
- The AI agent uses natural language processing and can handle variations in phrasing
- If an AI command doesn't work as expected, try rephrasing it or being more specific
- Multi-user features require opening multiple browser windows/tabs with different accounts
- Performance features are best tested with the AI agent creating many objects at once
- The application uses Supabase for real-time synchronization and authentication


