"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

type FunctionCall = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

type AIActionResult = {
  success: boolean;
  error?: string;
  [key: string]: any;
};

type ChatBoxProps = {
  onPanToCoordinate: (x: number, y: number) => void;
  canvasState: {
    centerX: number;
    centerY: number;
    scale: number;
    viewportWidth: number;
    viewportHeight: number;
  };
  getCanvasJSON: () => string;
  getSelectedShapeIds: () => string[];
  getUserCursors: () => Array<{ userId: string; email: string; worldX: number; worldY: number }>;
  getUIState: () => any;
  aiGetViewport: () => any;
  aiUpdateShapeProperties: (shapeId: string, updates: any) => Promise<AIActionResult>;
  aiRenameShape: (shapeId: string, newName: string) => Promise<AIActionResult>;
  aiAddAnnotation: (shapeId: string, text: string) => Promise<AIActionResult>;
  aiAddToSelection: (shapeIds: string[]) => AIActionResult;
  aiRemoveFromSelection: (shapeIds: string[]) => AIActionResult;
  aiClearSelection: () => AIActionResult;
  aiCreateShape: (params: any) => Promise<AIActionResult>;
  aiDeleteShapes: (shapeIds: string[]) => Promise<AIActionResult>;
  aiToggleShapeModal: (action: 'open' | 'close' | 'toggle', shapeId?: string) => AIActionResult;
  aiToggleDebugHUD: (action: 'show' | 'hide' | 'toggle') => AIActionResult;
  aiToggleCanvasMenu: (action: 'show' | 'hide' | 'toggle', tab?: 'export' | 'versions') => AIActionResult;
  aiDownloadPNG: () => AIActionResult;
  aiDownloadSVG: () => AIActionResult;
  aiDownloadJSON: () => AIActionResult;
  aiSaveVersion: () => Promise<AIActionResult>;
  aiRestoreVersion: (identifier: string | number) => Promise<AIActionResult>;
  aiSetZoom: (zoomLevel: number, focusX?: number, focusY?: number) => AIActionResult;
  aiSetPan: (x: number, y: number) => AIActionResult;
  aiCreateShapes: (shapesList: any[]) => Promise<AIActionResult>;
  aiAddAnnotations: (annotations: Array<{ shapeId: string; text: string }>) => Promise<AIActionResult>;
  aiUpdateShapesProperties: (shapeIds: string[], updates: any) => Promise<AIActionResult>;
  aiUpdateSelectionProperties: (updates: any) => Promise<AIActionResult>;
};

export default function ChatBox({ 
  onPanToCoordinate, 
  canvasState, 
  getCanvasJSON,
  getSelectedShapeIds,
  getUserCursors,
  getUIState,
  aiGetViewport,
  aiUpdateShapeProperties,
  aiRenameShape,
  aiAddAnnotation,
  aiAddToSelection,
  aiRemoveFromSelection,
  aiClearSelection,
  aiCreateShape,
  aiDeleteShapes,
  aiToggleShapeModal,
  aiToggleDebugHUD,
  aiToggleCanvasMenu,
  aiDownloadPNG,
  aiDownloadSVG,
  aiDownloadJSON,
  aiSaveVersion,
  aiRestoreVersion,
  aiSetZoom,
  aiSetPan,
  aiCreateShapes,
  aiAddAnnotations,
  aiUpdateShapesProperties,
  aiUpdateSelectionProperties,
}: ChatBoxProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    }
  }, [isExpanded]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      // Prepare message history for context (exclude system messages)
      const messageHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: inputValue,
          messageHistory, // Include conversation history for context
          canvasState,
          canvasJSON: getCanvasJSON(),
          selectedShapeIds: getSelectedShapeIds(),
          userCursors: getUserCursors(),
          uiState: getUIState(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data = await response.json();

      // Execute function calls
      if (data.functionCalls && data.functionCalls.length > 0) {
        console.log('ChatBox: Executing function calls:', data.functionCalls);
        for (const call of data.functionCalls) {
          try {
            console.log('ChatBox: Executing function:', call.name, call.arguments);
            if (call.name === "panToCoordinate") {
              onPanToCoordinate(call.arguments.x, call.arguments.y);
            } else if (call.name === "updateShapeProperties") {
              console.log('ChatBox: Calling aiUpdateShapeProperties with:', call.arguments.shapeId, call.arguments.updates);
              const result = await aiUpdateShapeProperties(call.arguments.shapeId, call.arguments.updates);
              console.log('ChatBox: aiUpdateShapeProperties result:', result);
              if (!result.success && result.error) {
                console.error('Update failed:', result.error);
              }
            } else if (call.name === "renameShape") {
              const result = await aiRenameShape(call.arguments.shapeId, call.arguments.newName);
              if (!result.success && result.error) {
                console.error('Rename failed:', result.error);
              }
            } else if (call.name === "addAnnotation") {
              const result = await aiAddAnnotation(call.arguments.shapeId, call.arguments.text);
              if (!result.success && result.error) {
                console.error('Annotation failed:', result.error);
              }
            } else if (call.name === "addToSelection") {
              const result = aiAddToSelection(call.arguments.shapeIds);
              if (!result.success && result.error) {
                console.error('Selection add failed:', result.error);
              }
            } else if (call.name === "removeFromSelection") {
              aiRemoveFromSelection(call.arguments.shapeIds);
            } else if (call.name === "clearSelection") {
              aiClearSelection();
            } else if (call.name === "createShape") {
              const result = await aiCreateShape(call.arguments);
              if (!result.success && result.error) {
                console.error('Shape creation failed:', result.error);
              }
            } else if (call.name === "deleteShapes") {
              const result = await aiDeleteShapes(call.arguments.shapeIds);
              if (!result.success && result.error) {
                console.error('Shape deletion failed:', result.error);
              }
            } else if (call.name === "toggleShapeModal") {
              const result = aiToggleShapeModal(call.arguments.action, call.arguments.shapeId);
              if (!result.success && result.error) {
                console.error('Modal toggle failed:', result.error);
              }
            } else if (call.name === "toggleDebugHUD") {
              aiToggleDebugHUD(call.arguments.action);
            } else if (call.name === "toggleCanvasMenu") {
              aiToggleCanvasMenu(call.arguments.action, call.arguments.tab);
            } else if (call.name === "downloadPNG") {
              aiDownloadPNG();
            } else if (call.name === "downloadSVG") {
              aiDownloadSVG();
            } else if (call.name === "downloadJSON") {
              aiDownloadJSON();
            } else if (call.name === "saveVersion") {
              const result = await aiSaveVersion();
              if (!result.success) {
                console.error('Version save failed');
              }
            } else if (call.name === "restoreVersion") {
              const result = await aiRestoreVersion(call.arguments.identifier);
              if (!result.success && result.error) {
                console.error('Version restore failed:', result.error);
              }
            } else if (call.name === "setZoom") {
              const result = aiSetZoom(call.arguments.zoomLevel, call.arguments.focusX, call.arguments.focusY);
              if (!result.success && result.error) {
                console.error('Zoom change failed:', result.error);
              }
            } else if (call.name === "setPan") {
              const result = aiSetPan(call.arguments.x, call.arguments.y);
              if (!result.success && result.error) {
                console.error('Pan change failed:', result.error);
              }
            } else if (call.name === "createShapes") {
              const result = await aiCreateShapes(call.arguments.shapes);
              if (!result.success && result.error) {
                console.error('Batch shape creation failed:', result.error);
              }
            } else if (call.name === "addAnnotations") {
              const result = await aiAddAnnotations(call.arguments.annotations);
              if (!result.success && result.error) {
                console.error('Batch annotation failed:', result.error);
              }
            } else if (call.name === "updateShapesProperties") {
              console.log('ChatBox: updateShapesProperties called with arguments:', JSON.stringify(call.arguments, null, 2));
              const result = await aiUpdateShapesProperties(call.arguments.shapeIds, call.arguments.updates);
              console.log('ChatBox: updateShapesProperties result:', result);
              if (!result.success && result.error) {
                console.error('Batch shape update failed:', result.error);
              }
            } else if (call.name === "updateSelectionProperties") {
              const result = await aiUpdateSelectionProperties(call.arguments.updates);
              if (!result.success && result.error) {
                console.error('Selection update failed:', result.error);
              }
            }
            // For read-only functions, the data is already included in call.data
            // The AI will format and present this information in its response
          } catch (error) {
            console.error('Function execution error:', error);
          }
        }
      }

      // Add assistant response
      if (data.message) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white rounded-full shadow-2xl flex flex-col items-center justify-center gap-1 transition-all duration-200 hover:scale-105 relative overflow-hidden"
        style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999, width: '70px', height: '110px' }}
        title="Open AI Assistant"
      >
        {/* Animated sparkle icons */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          className="w-5 h-5 absolute"
          style={{
            top: '12px',
            animation: 'twinkle1 2s ease-in-out infinite'
          }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
          />
        </svg>
        
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-8 h-8"
          style={{
            animation: 'twinkle2 2.5s ease-in-out infinite'
          }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
          />
        </svg>
        
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          className="w-4 h-4 absolute"
          style={{
            bottom: '12px',
            animation: 'twinkle3 3s ease-in-out infinite'
          }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
          />
        </svg>
        
        <style jsx>{`
          @keyframes twinkle1 {
            0%, 100% {
              opacity: 0.6;
              transform: scale(0.9) rotate(0deg);
            }
            50% {
              opacity: 1;
              transform: scale(1.2) rotate(180deg);
            }
          }
          @keyframes twinkle2 {
            0%, 100% {
              opacity: 1;
              transform: scale(1) rotate(0deg);
            }
            50% {
              opacity: 0.7;
              transform: scale(1.15) rotate(90deg);
            }
          }
          @keyframes twinkle3 {
            0%, 100% {
              opacity: 0.7;
              transform: scale(0.95) rotate(0deg);
            }
            50% {
              opacity: 1;
              transform: scale(1.1) rotate(-180deg);
            }
          }
        `}</style>
      </button>
    );
  }

  return (
    <div 
      className="w-96 h-[500px] bg-white rounded-lg shadow-2xl flex flex-col border border-gray-200"
      style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-blue-600 text-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
            />
          </svg>
          <h3 className="font-semibold">AI Assistant</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMessages([])}
            className="text-white hover:bg-blue-700 rounded p-1 transition-colors"
            title="Clear conversation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
          </button>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-white hover:bg-blue-700 rounded p-1 transition-colors"
            title="Minimize"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <p className="mb-2">👋 Hi! I'm your AI assistant.</p>
            <p>I can help you:</p>
            <ul className="mt-2 text-left inline-block text-xs">
              <li>• "Create a blue circle at 500, 300"</li>
              <li>• "Delete the selected shapes"</li>
              <li>• "Zoom to 200%"</li>
              <li>• "Move BigCircle to 100, 200"</li>
              <li>• "Change the fill color to red"</li>
              <li>• "Add 2 sides to the hexagon"</li>
              <li>• "Toggle the debug HUD"</li>
              <li>• "Download this canvas as PNG"</li>
              <li>• "Save this version"</li>
              <li>• "What's the current zoom?"</li>
            </ul>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-900 rounded-lg px-4 py-2">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me to pan the canvas..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            disabled={isLoading}
          />
          <button
            onClick={handleSendMessage}
            disabled={isLoading || !inputValue.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

