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
  aiUpdateShapeProperties: (shapeId: string, updates: any) => Promise<AIActionResult>;
  aiRenameShape: (shapeId: string, newName: string) => Promise<AIActionResult>;
  aiAddAnnotation: (shapeId: string, text: string) => Promise<AIActionResult>;
  aiAddToSelection: (shapeIds: string[]) => AIActionResult;
  aiRemoveFromSelection: (shapeIds: string[]) => AIActionResult;
  aiClearSelection: () => AIActionResult;
};

export default function ChatBox({ 
  onPanToCoordinate, 
  canvasState, 
  getCanvasJSON,
  getSelectedShapeIds,
  getUserCursors,
  aiUpdateShapeProperties,
  aiRenameShape,
  aiAddAnnotation,
  aiAddToSelection,
  aiRemoveFromSelection,
  aiClearSelection,
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
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: inputValue,
          canvasState,
          canvasJSON: getCanvasJSON(),
          selectedShapeIds: getSelectedShapeIds(),
          userCursors: getUserCursors(),
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
        className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-110"
        style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999 }}
        title="Open AI Assistant"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
          />
        </svg>
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <p className="mb-2">👋 Hi! I'm your AI assistant.</p>
            <p>I can help you:</p>
            <ul className="mt-2 text-left inline-block text-xs">
              <li>• "Move the selected shape to 500, 300"</li>
              <li>• "Change the color of BigCircle to red"</li>
              <li>• "Make the selected shape bigger"</li>
              <li>• "Rename this shape to BlueSquare"</li>
              <li>• "Add a note: 'needs review'"</li>
              <li>• "Select all circles"</li>
              <li>• "What's on the canvas?"</li>
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

