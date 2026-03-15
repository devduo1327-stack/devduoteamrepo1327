export interface Player {
  id: string;
  name: string;
  score: number;
  coins: number;
  isReady: boolean;
  isHost: boolean;
  isBot?: boolean;
  hasGuessedCorrectly?: boolean;
  lastActive: string;
}

export interface Room {
  id: string;
  name: string;
  status: 'waiting' | 'playing' | 'finished';
  mode: 'classic' | 'theme' | 'speed';
  currentRound: number;
  totalRounds: number;
  currentDrawerId: string;
  currentWord: string;
  timeLeft: number;
  createdAt: string;
  isQuickPlay?: boolean;
  hostId: string;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type: 'chat' | 'guess' | 'system';
  createdAt: string;
}

export interface DrawingLine {
  tool: string;
  points: number[];
  color: string;
  strokeWidth: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  totalCoins: number;
  inventory: {
    freeze: number;
    hint: number;
    reveal: number;
    skip: number;
  };
  lastActive: string;
}
