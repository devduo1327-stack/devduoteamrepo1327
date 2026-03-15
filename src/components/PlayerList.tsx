import React from 'react';
import { Player } from '../types';
import { Trophy, Coins, User, Crown } from 'lucide-react';

interface PlayerListProps {
  players: Player[];
  currentDrawerId: string;
}

export const PlayerList: React.FC<PlayerListProps> = ({ players, currentDrawerId }) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Players</h3>
        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
          {players.length}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {players.sort((a, b) => b.score - a.score).map((player) => (
          <div key={player.id} className="p-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
            <div className="relative">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                <User size={20} />
              </div>
              {currentDrawerId === player.id && (
                <div className="absolute -top-1 -right-1 bg-amber-400 text-white p-1 rounded-full shadow-sm animate-bounce">
                  <span className="text-[10px] font-bold">✏️</span>
                </div>
              )}
              {player.isHost && (
                <div className="absolute -bottom-1 -right-1 bg-indigo-600 text-white p-0.5 rounded-full shadow-sm">
                  <Crown size={10} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{player.name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                  <Trophy size={10} className="text-amber-500" />
                  {player.score}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                  <Coins size={10} className="text-yellow-500" />
                  {player.coins}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
