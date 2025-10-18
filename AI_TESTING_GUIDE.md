# AI Testing Guide - Extended Capabilities

This guide provides a comprehensive testing checklist for all AI capabilities.

## Prerequisites
- Ensure the dev server is running: `npm run dev`
- Open the canvas at http://localhost:3000/canvas
- Open the AI chatbox (blue sparkle icon in bottom-right)

## Test Categories

### 1. Shape Creation Tests

#### Basic Creation
- [ ] **Test:** "Create a rectangle at 500, 500"
  - **Expected:** New rectangle appears at specified position
  - **Verify:** Shape has default properties (4 sides, black stroke, white fill)

- [ ] **Test:** "Create a blue circle at 1000, 300 that's 200 pixels wide"
  - **Expected:** Blue circle appears at position
  - **Verify:** Circle (0 sides), blue fill, correct size

- [ ] **Test:** "Make a red hexagon at the origin"
  - **Expected:** Red hexagon at (0, 0)
  - **Verify:** 6 sides, red color

- [ ] **Test:** "Add a triangle at 200, 200 with text 'Hello'"
  - **Expected:** Triangle with text overlay
  - **Verify:** 3 sides, text visible

#### Advanced Creation
- [ ] **Test:** "Create 3 circles in a horizontal line starting at 100, 100"
  - **Expected:** 3 circles arranged horizontally
  - **Verify:** Equal spacing, correct alignment

- [ ] **Test:** "Make a green pentagon with no fill at 500, 500"
  - **Expected:** Pentagon outline only
  - **Verify:** 5 sides, green stroke, null fill

### 2. Shape Deletion Tests

#### Basic Deletion
- [ ] **Setup:** Select a single shape
- [ ] **Test:** "Delete the selected shape"
  - **Expected:** Shape disappears immediately
  - **Verify:** Database update, broadcast to other users

- [ ] **Setup:** Select multiple shapes
- [ ] **Test:** "Delete all selected shapes"
  - **Expected:** All selected shapes removed
  - **Verify:** Selection cleared after deletion

#### Named Deletion
- [ ] **Setup:** Note the name of a shape (e.g., "BigCircle")
- [ ] **Test:** "Delete BigCircle"
  - **Expected:** AI finds and deletes the named shape
  - **Verify:** Other shapes unaffected

- [ ] **Test:** "Remove all triangles"
  - **Expected:** AI identifies all triangles and deletes them
  - **Verify:** Parallel deletion of multiple shapes

### 3. UI Control Tests

#### Shape Modal Control
- [ ] **Test:** "Open the properties modal for BigCircle"
  - **Expected:** Modal opens showing BigCircle's properties
  - **Verify:** Correct shape ID in modal

- [ ] **Test:** "Show me the properties panel"
  - **Expected:** If a shape is selected, opens modal for it
  - **Verify:** Appropriate error if no shape selected

- [ ] **Test:** "Close the modal"
  - **Expected:** Properties modal closes
  - **Verify:** Modal state updates

- [ ] **Test:** "Toggle the property editor"
  - **Expected:** Modal opens if closed, closes if open
  - **Verify:** Toggle works correctly

#### Debug HUD Control
- [ ] **Test:** "Show the debug HUD"
  - **Expected:** Debug overlay appears in bottom-left
  - **Verify:** Shows scroll position and scale

- [ ] **Test:** "Hide debug mode"
  - **Expected:** Debug overlay disappears
  - **Verify:** HUD completely hidden

- [ ] **Test:** "Toggle the debug overlay"
  - **Expected:** HUD toggles on/off
  - **Verify:** State persists correctly

#### Canvas Menu Control
- [ ] **Test:** "Open the canvas menu"
  - **Expected:** Canvas menu opens
  - **Verify:** Shows export and versions tabs

- [ ] **Test:** "Show the export tab"
  - **Expected:** Menu opens with export tab active
  - **Verify:** Export buttons visible

- [ ] **Test:** "Open the versions menu"
  - **Expected:** Menu opens with versions tab active
  - **Verify:** Saved versions list visible

- [ ] **Test:** "Close the canvas menu"
  - **Expected:** Menu closes
  - **Verify:** Menu state updates

### 4. Export Tests

#### PNG Export
- [ ] **Setup:** Create some shapes on canvas
- [ ] **Test:** "Download this as PNG"
  - **Expected:** PNG file downloads
  - **Verify:** File contains canvas snapshot

- [ ] **Test:** "Export to image"
  - **Expected:** PNG download initiated
  - **Verify:** Image quality acceptable

#### SVG Export
- [ ] **Test:** "Download as SVG"
  - **Expected:** SVG file downloads
  - **Verify:** SVG is vector format, scalable

- [ ] **Test:** "Save as vector"
  - **Expected:** SVG export triggered
  - **Verify:** All shapes preserved in SVG

#### JSON Export
- [ ] **Test:** "Download the canvas data"
  - **Expected:** JSON file downloads
  - **Verify:** JSON contains complete canvas state

- [ ] **Test:** "Export as JSON"
  - **Expected:** JSON download
  - **Verify:** File includes shapes, annotations, metadata

### 5. Version Control Tests

#### Save Version
- [ ] **Setup:** Create unique canvas state
- [ ] **Test:** "Save this version"
  - **Expected:** Version saved to database
  - **Verify:** New version appears in versions list

- [ ] **Test:** "Create a snapshot"
  - **Expected:** Current state saved
  - **Verify:** Timestamp and user recorded

#### Restore Version - Basic
- [ ] **Setup:** Save 2-3 versions with different states
- [ ] **Test:** "Restore the last version"
  - **Expected:** Canvas reverts to most recent saved state
  - **Verify:** All shapes match saved version

- [ ] **Test:** "Go back to the previous version"
  - **Expected:** Canvas reverts to second most recent
  - **Verify:** Correct version restored

#### Restore Version - Advanced
- [ ] **Test:** "Restore the penultimate version"
  - **Expected:** Second most recent version restored
  - **Verify:** Natural language understood

- [ ] **Setup:** Note a version's timestamp
- [ ] **Test:** "Restore the version from 14:30"
  - **Expected:** AI finds version by time substring
  - **Verify:** Correct version identified

- [ ] **Test:** "Load the version from 3 versions ago"
  - **Expected:** Third most recent version restored
  - **Verify:** Indexing works correctly

- [ ] **Test:** "Restore the version from yesterday"
  - **Expected:** AI searches by date
  - **Verify:** Date matching works (if versions exist)

### 6. UI State Inspection Tests

- [ ] **Setup:** Open a modal, hide debug HUD
- [ ] **Test:** "What modals are open?"
  - **Expected:** AI reports current modal state
  - **Verify:** Accurate information provided

- [ ] **Test:** "Is the debug HUD visible?"
  - **Expected:** AI answers yes/no correctly
  - **Verify:** Current state reflected

- [ ] **Test:** "How many versions are saved?"
  - **Expected:** AI reports version count
  - **Verify:** Matches actual versions list

### 7. Complex Multi-Step Workflows

#### Creation + Export
- [ ] **Test:** "Create a blue square at 500, 500 then download it as PNG"
  - **Expected:** Square created, then PNG downloads
  - **Verify:** Both operations execute in sequence

#### Modification + Save
- [ ] **Test:** "Change BigCircle to red and save this version"
  - **Expected:** Color changes, version saved
  - **Verify:** Version contains red circle

#### Multiple Operations
- [ ] **Test:** "Create 3 shapes, arrange them in a line, then export as SVG"
  - **Expected:** All operations execute
  - **Verify:** Shapes created, positioned, exported

#### Conditional Operations
- [ ] **Test:** "If there are more than 5 shapes, save a version"
  - **Expected:** AI checks count, saves if condition met
  - **Verify:** Logic correctly evaluated

### 8. Error Handling Tests

#### Invalid Shape References
- [ ] **Test:** "Delete NonExistentShape"
  - **Expected:** AI reports shape not found
  - **Verify:** Helpful error message

#### Invalid Parameters
- [ ] **Test:** "Create a shape at invalid, coordinates"
  - **Expected:** AI handles parsing error
  - **Verify:** User-friendly error response

#### Permission Errors
- [ ] **Test:** Try operations when database is unavailable
  - **Expected:** Graceful error handling
  - **Verify:** Rollback occurs

### 9. Parallel Operations Test

- [ ] **Test:** "Place all the shapes in a grid layout"
  - **Expected:** AI makes multiple updateShapeProperties calls
  - **Verify:** All shapes move simultaneously

- [ ] **Test:** "Change all circles to blue and all squares to red"
  - **Expected:** Parallel color updates
  - **Verify:** No race conditions

### 10. Integration Tests

#### With Existing Features
- [ ] **Test:** Manually modify shape, then ask AI about it
  - **Expected:** AI sees current state
  - **Verify:** State synchronization works

- [ ] **Test:** AI creates shape, manually select it, AI modifies it
  - **Expected:** Selection state preserved
  - **Verify:** Manual and AI actions integrate

#### Multi-User Scenarios
- [ ] **Setup:** Open canvas in two browsers
- [ ] **Test:** AI creates shape in browser 1
  - **Expected:** Shape appears in browser 2
  - **Verify:** Real-time sync works

- [ ] **Test:** AI deletes shape in browser 1
  - **Expected:** Shape disappears in browser 2
  - **Verify:** Broadcast working

## Performance Tests

### Latency
- [ ] **Test:** "Create a shape"
  - **Measure:** Time from send to UI update
  - **Target:** < 2 seconds for simple operations

### Batch Operations
- [ ] **Test:** "Create 10 shapes"
  - **Measure:** Total time, UI responsiveness
  - **Target:** Smooth UI, no blocking

### Large Canvas
- [ ] **Setup:** Canvas with 50+ shapes
- [ ] **Test:** AI operations on large canvas
  - **Expected:** No performance degradation
  - **Verify:** Response time acceptable

## Edge Cases

- [ ] Empty canvas + "delete all shapes" → Graceful handling
- [ ] No versions saved + "restore last version" → Helpful error
- [ ] Modal already open + "open modal" → No-op or appropriate response
- [ ] Simultaneous AI and manual operations → No conflicts

## Regression Tests

Verify existing features still work:
- [ ] Pan to coordinate
- [ ] Update shape properties
- [ ] Rename shapes
- [ ] Add annotations
- [ ] Selection manipulation
- [ ] Canvas inspection

## Success Criteria

✅ All basic tests pass
✅ No console errors during normal operation
✅ Database persists correctly
✅ Real-time sync works across users
✅ Error messages are helpful and accurate
✅ Performance is acceptable for typical use cases
✅ AI responses are natural and informative
✅ UI updates are immediate (optimistic)
✅ Version control is reliable

## Bug Reporting

If a test fails, note:
1. Exact command given to AI
2. Expected behavior
3. Actual behavior
4. Console errors (if any)
5. Browser and version
6. Steps to reproduce

