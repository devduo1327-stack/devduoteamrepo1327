import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import { Send } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  currentUserEmail: string | null;
  isDrawer: boolean;
}

export const Chat: React.FC<ChatProps> = ({ messages, onSendMessage, currentUserEmail, isDrawer }) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="p-3 bg-slate-100 border-bottom border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Chat & Guesses</h3>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 scroll-smooth">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "text-sm p-2 rounded-lg max-w-[90%]",
              msg.type === 'system' ? "bg-slate-200 text-slate-600 italic mx-auto text-center w-full" :
              msg.type === 'guess' ? "bg-emerald-100 text-emerald-800 font-medium border border-emerald-200" :
              "bg-white text-slate-800 border border-slate-100 shadow-sm"
            )}
          >
            {msg.type !== 'system' && (
              <span className="font-bold mr-1">{msg.senderName}:</span>
            )}
            <span>{msg.text}</span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-200 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isDrawer ? "You are drawing..." : "Type your guess or chat..."}
          disabled={isDrawer}
          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isDrawer || !input.trim()}
          className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
};
