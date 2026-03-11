/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  serverTimestamp,
  getDoc,
  getDocs,
  deleteDoc,
  runTransaction
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { db, auth } from './firebase';
import { Room, Player, Message, DrawingLine } from './types';
import { WORD_LIST, THEME_WORDS, MODE_CONFIG, ROUND_TIME, TOTAL_ROUNDS, POINTS_PER_GUESS, COINS_PER_GUESS } from './constants';
import { Canvas } from './components/Canvas';
import { Chat } from './components/Chat';
import { PlayerList } from './components/PlayerList';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, LogIn, Trophy, Coins, Palette, Eraser, Trash2, Play, Crown, Loader2, AlertCircle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, errorInfo: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error && parsed.error.includes("permission-denied")) {
          displayMessage = "You don't have permission to access this data. Please try refreshing or joining a different room.";
        }
      } catch (e) {
        // Not JSON
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-rose-100">
            <AlertCircle className="w-16 h-16 text-rose-500 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-slate-800 mb-2">Oops!</h2>
            <p className="text-slate-500 mb-8">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const BOT_NAMES = ["ZoodleBot", "DoodleMaster", "Sketchy", "Artie", "PicasBot"];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drawingLines, setDrawingLines] = useState<DrawingLine[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'landing' | 'lobby' | 'game' | 'results'>('landing');
  const [userCoins, setUserCoins] = useState(0);
  
  // Drawing state
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushWidth, setBrushWidth] = useState(5);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [toast, setToast] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<'classic' | 'theme' | 'speed'>('classic');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Auto-start logic for Quick Play rooms (only for host)
  useEffect(() => {
    if (!currentRoom || currentRoom.status !== 'waiting' || !currentRoom.isQuickPlay || !user) return;
    
    const host = players.find(p => p.isHost);
    if (host?.id !== user.uid) return;

    // If we have enough players (e.g., 3 including bots), start immediately
    if (players.length >= 3) {
      startGame();
    }
  }, [currentRoom, players, user]);

  // Persistent User Data Listener
  useEffect(() => {
    if (!user) {
      setUserCoins(0);
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const unsubUser = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setUserCoins(doc.data().totalCoins || 0);
      } else {
        // Initialize user doc if it doesn't exist
        setDoc(userRef, {
          displayName: user.displayName || 'Anonymous',
          totalCoins: 0,
          lastActive: serverTimestamp()
        }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubUser();
  }, [user]);

  // Room listener
  useEffect(() => {
    if (!currentRoom?.id) return;

    const roomRef = doc(db, 'rooms', currentRoom.id);
    const unsubRoom = onSnapshot(roomRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data() as Room;
        setCurrentRoom({ ...data, id: doc.id });
        if (data.status === 'playing') setView('game');
        else if (data.status === 'finished') setView('results');
        else setView('lobby');
      } else {
        setCurrentRoom(null);
        setView('landing');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `rooms/${currentRoom.id}`);
    });

    const playersRef = collection(db, 'rooms', currentRoom.id, 'players');
    const unsubPlayers = onSnapshot(playersRef, (snapshot) => {
      const pList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Player));
      setPlayers(pList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `rooms/${currentRoom.id}/players`);
    });

    const messagesRef = collection(db, 'rooms', currentRoom.id, 'messages');
    const qMessages = query(messagesRef, orderBy('createdAt', 'asc'), limit(50));
    const unsubMessages = onSnapshot(qMessages, (snapshot) => {
      const mList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Message));
      setMessages(mList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `rooms/${currentRoom.id}/messages`);
    });

    const drawingRef = doc(db, 'rooms', currentRoom.id, 'drawing', 'current');
    const unsubDrawing = onSnapshot(drawingRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setDrawingLines(JSON.parse(data.lines || '[]'));
      } else {
        setDrawingLines([]);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `rooms/${currentRoom.id}/drawing/current`);
    });

    return () => {
      unsubRoom();
      unsubPlayers();
      unsubMessages();
      unsubDrawing();
    };
  }, [currentRoom?.id]);

  // Timer logic (only for host)
  useEffect(() => {
    if (!currentRoom || currentRoom.status !== 'playing' || !user) return;
    
    const host = players.find(p => p.isHost);
    if (host?.id !== user.uid) return;

    const interval = setInterval(async () => {
      if (currentRoom.timeLeft > 0) {
        await updateDoc(doc(db, 'rooms', currentRoom.id), {
          timeLeft: currentRoom.timeLeft - 1
        });
      } else {
        // Round ended
        handleRoundEnd();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentRoom, players, user]);

  // Bot logic (only for host)
  useEffect(() => {
    if (!currentRoom || currentRoom.status !== 'playing' || !user) return;
    
    const host = players.find(p => p.isHost);
    if (host?.id !== user.uid) return;

    const bots = players.filter(p => p.isBot);
    if (bots.length === 0) return;

    const botInterval = setInterval(async () => {
      const activeBot = bots[Math.floor(Math.random() * bots.length)];
      
      // Bot Guessing
      if (activeBot.id !== currentRoom.currentDrawerId) {
        // 10% chance to guess correctly every 5 seconds
        const shouldGuessCorrect = Math.random() < 0.1;
        if (shouldGuessCorrect) {
          await handleBotGuess(activeBot, currentRoom.currentWord);
        } else if (Math.random() < 0.2) {
          // 20% chance to guess something random
          const randomGuesses = ["Is it a cat?", "Looks like a tree", "Maybe a house?", "I don't know!", "Cool drawing!"];
          await handleBotGuess(activeBot, randomGuesses[Math.floor(Math.random() * randomGuesses.length)]);
        }
      }

      // Bot Drawing (if bot is drawer)
      if (activeBot.id === currentRoom.currentDrawerId) {
        // Bots "draw" by adding a random line occasionally
        const newLine: DrawingLine = {
          tool: 'pen',
          points: [Math.random() * 500, Math.random() * 400, Math.random() * 500, Math.random() * 400],
          color: '#'+Math.floor(Math.random()*16777215).toString(16),
          strokeWidth: 5
        };
        const updatedLines = [...drawingLines, newLine];
        await handleDraw(updatedLines);
      }
    }, 5000);

    return () => clearInterval(botInterval);
  }, [currentRoom, players, user, drawingLines]);

  const handleBotGuess = async (bot: Player, text: string) => {
    if (!currentRoom) return;
    
    const isCorrect = text.toLowerCase() === currentRoom.currentWord.toLowerCase();
    
    if (isCorrect) {
      await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
        senderId: 'system',
        senderName: 'System',
        text: `${bot.name} guessed the word!`,
        type: 'guess',
        createdAt: serverTimestamp()
      });

      const botRef = doc(db, 'rooms', currentRoom.id, 'players', bot.id);
      const config = MODE_CONFIG[currentRoom.mode];
      await updateDoc(botRef, {
        score: bot.score + Math.round(POINTS_PER_GUESS * config.pointsMultiplier),
        coins: bot.coins + Math.round(COINS_PER_GUESS * config.pointsMultiplier)
      });
    } else {
      await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
        senderId: bot.id,
        senderName: bot.name,
        text,
        type: 'chat',
        createdAt: serverTimestamp()
      });
    }
  };

  const handleRoundEnd = async () => {
    if (!currentRoom) return;
    
    const config = MODE_CONFIG[currentRoom.mode];
    const nextRound = currentRoom.currentRound + 1;
    if (nextRound > config.totalRounds) {
      await updateDoc(doc(db, 'rooms', currentRoom.id), { status: 'finished' });
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    } else {
      // Pick next drawer
      const currentIndex = players.findIndex(p => p.id === currentRoom.currentDrawerId);
      const nextIndex = (currentIndex + 1) % players.length;
      const nextDrawer = players[nextIndex];
      
      let nextWord = '';
      if (currentRoom.mode === 'theme') {
        const themes = Object.keys(THEME_WORDS) as (keyof typeof THEME_WORDS)[];
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];
        const words = THEME_WORDS[randomTheme];
        nextWord = words[Math.floor(Math.random() * words.length)];
      } else {
        nextWord = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
      }

      await updateDoc(doc(db, 'rooms', currentRoom.id), {
        currentRound: nextRound,
        currentDrawerId: nextDrawer.id,
        currentWord: nextWord,
        timeLeft: config.roundTime
      });

      // Clear canvas
      await setDoc(doc(db, 'rooms', currentRoom.id, 'drawing', 'current'), {
        lines: '[]',
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
        senderId: 'system',
        senderName: 'System',
        text: `Round ${nextRound} started! ${nextDrawer.name} is drawing.`,
        type: 'system',
        createdAt: serverTimestamp()
      });
    }
  };

  const joinRoom = async (roomId: string) => {
    if (!user || !playerName.trim()) return;
    setLoading(true);
    try {
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await getDoc(roomRef);
      
      if (!roomSnap.exists()) {
        showToast('Room not found');
        return;
      }

      const playerRef = doc(db, 'rooms', roomId, 'players', user.uid);
      await setDoc(playerRef, {
        name: playerName,
        score: 0,
        coins: 0,
        isReady: false,
        isHost: false,
        lastActive: new Date().toISOString()
      });

      setCurrentRoom({ ...roomSnap.data(), id: roomId } as Room);
      setView('lobby');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const createRoom = async (withBots = false, autoStart = false) => {
    if (!user || !playerName.trim()) return;
    setLoading(true);
    try {
      const config = MODE_CONFIG[selectedMode];
      const roomName = `${playerName}'s Room`;
      const roomData = {
        name: roomName,
        status: 'waiting',
        mode: selectedMode,
        currentRound: 0,
        totalRounds: config.totalRounds,
        currentDrawerId: '',
        currentWord: '',
        timeLeft: config.roundTime,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
        isQuickPlay: withBots,
        hostId: user.uid
      };

      const roomRef = await addDoc(collection(db, 'rooms'), roomData);
      
      const playerRef = doc(db, 'rooms', roomRef.id, 'players', user.uid);
      await setDoc(playerRef, {
        name: playerName,
        score: 0,
        coins: 0,
        isReady: true,
        isHost: true,
        lastActive: new Date().toISOString()
      });

      const botPlayers: Player[] = [];
      if (withBots) {
        // Add 2 bots
        for (let i = 0; i < 2; i++) {
          const botId = `bot_${Math.random().toString(36).substr(2, 9)}`;
          const botData = {
            id: botId,
            name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
            score: 0,
            coins: 0,
            isReady: true,
            isHost: false,
            isBot: true,
            lastActive: new Date().toISOString()
          };
          await setDoc(doc(db, 'rooms', roomRef.id, 'players', botId), botData);
          botPlayers.push(botData);
        }
      }

      const finalRoom = { ...roomData, id: roomRef.id } as unknown as Room;
      setCurrentRoom(finalRoom);
      
      if (autoStart) {
        // We need the players list to start the game
        const allPlayers = [{ id: user.uid, name: playerName, score: 0, coins: 0, isReady: true, isHost: true, lastActive: new Date().toISOString() }, ...botPlayers];
        await startGameInternal(finalRoom, allPlayers);
      } else {
        setView('lobby');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const startGame = async () => {
    if (!currentRoom || !user) return;
    await startGameInternal(currentRoom, players);
  };

  const startGameInternal = async (room: Room, playerList: Player[]) => {
    const config = MODE_CONFIG[room.mode];
    const firstDrawer = playerList[0];
    
    let firstWord = '';
    if (room.mode === 'theme') {
      const themes = Object.keys(THEME_WORDS) as (keyof typeof THEME_WORDS)[];
      const randomTheme = themes[Math.floor(Math.random() * themes.length)];
      const words = THEME_WORDS[randomTheme];
      firstWord = words[Math.floor(Math.random() * words.length)];
    } else {
      firstWord = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    }

    await updateDoc(doc(db, 'rooms', room.id), {
      status: 'playing',
      currentRound: 1,
      currentDrawerId: firstDrawer.id,
      currentWord: firstWord,
      timeLeft: config.roundTime
    });

    await addDoc(collection(db, 'rooms', room.id, 'messages'), {
      senderId: 'system',
      senderName: 'System',
      text: `Game started! ${firstDrawer.name} is drawing.`,
      type: 'system',
      createdAt: serverTimestamp()
    });
  };

  const handleDraw = async (lines: DrawingLine[]) => {
    if (!currentRoom) return;
    await setDoc(doc(db, 'rooms', currentRoom.id, 'drawing', 'current'), {
      lines: JSON.stringify(lines),
      updatedAt: serverTimestamp()
    });
  };

  const handleSendMessage = async (text: string) => {
    if (!currentRoom || !user) return;

    const isCorrect = text.toLowerCase() === currentRoom.currentWord.toLowerCase();
    const isDrawer = user.uid === currentRoom.currentDrawerId;

    if (isCorrect && !isDrawer && currentRoom.status === 'playing') {
      // Correct guess!
      await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
        senderId: 'system',
        senderName: 'System',
        text: `${playerName} guessed the word!`,
        type: 'guess',
        createdAt: serverTimestamp()
      });

      // Update score in room and persistent coins
      const playerRef = doc(db, 'rooms', currentRoom.id, 'players', user.uid);
      const userRef = doc(db, 'users', user.uid);
      const config = MODE_CONFIG[currentRoom.mode];
      const earnedCoins = Math.round(COINS_PER_GUESS * config.pointsMultiplier);
      const earnedPoints = Math.round(POINTS_PER_GUESS * config.pointsMultiplier);

      await runTransaction(db, async (transaction) => {
        const pSnap = await transaction.get(playerRef);
        const uSnap = await transaction.get(userRef);

        if (pSnap.exists()) {
          const data = pSnap.data();
          transaction.update(playerRef, {
            score: data.score + earnedPoints,
            coins: data.coins + earnedCoins
          });
        }

        if (uSnap.exists()) {
          const uData = uSnap.data();
          transaction.update(userRef, {
            totalCoins: (uData.totalCoins || 0) + earnedCoins,
            lastActive: serverTimestamp()
          });
        }
      });
    } else {
      await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
        senderId: user.uid,
        senderName: playerName,
        text,
        type: 'chat',
        createdAt: serverTimestamp()
      });
    }
  };

  const quickPlay = async () => {
    if (!user || !playerName.trim()) {
      showToast("Please enter a nickname first");
      return;
    }
    setLoading(true);
    try {
      // Find a waiting room with players that is a Quick Play room
      const roomsRef = collection(db, 'rooms');
      const q = query(roomsRef, 
        where('status', '==', 'waiting'), 
        where('isQuickPlay', '==', true),
        limit(20)
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const rooms = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const randomRoom = rooms[Math.floor(Math.random() * rooms.length)];
        await joinRoom(randomRoom.id);
      } else {
        // Create a new room with bots and start immediately
        await createRoom(true, true);
      }
    } catch (e) {
      console.error(e);
      showToast("Failed to find a room");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-indigo-600 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <h1 className="text-2xl font-bold animate-pulse">Loading Zoodle...</h1>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-indigo-600 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full text-center"
        >
          <h1 className="text-4xl font-black text-indigo-600 mb-2 italic">ZOODLE</h1>
          <p className="text-slate-500 mb-8">The ultimate drawing & guessing game</p>
          <button 
            onClick={() => {
              const provider = new GoogleAuthProvider();
              signInWithPopup(auth, provider).catch(err => {
                console.error(err);
                showToast("Failed to sign in with Google");
              });
            }}
            className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-200 flex items-center justify-center gap-2"
          >
            <Play fill="currentColor" size={20} />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        <AnimatePresence mode="wait">
          {/* ... existing views ... */}
        {view === 'landing' && (
          <motion.div 
            key="landing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="max-w-4xl mx-auto pt-20 px-4"
          >
            <div className="text-center mb-12">
              <h1 className="text-6xl font-black text-indigo-600 mb-4 italic tracking-tighter">ZOODLE</h1>
              <div className="flex items-center justify-center gap-6">
                <div className="flex items-center gap-4 text-slate-500 font-medium">
                  <span className="flex items-center gap-1"><Trophy size={16} className="text-amber-500" /> Compete</span>
                  <span className="flex items-center gap-1"><Palette size={16} className="text-indigo-500" /> Draw</span>
                  <span className="flex items-center gap-1"><Coins size={16} className="text-yellow-500" /> Earn</span>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div className="bg-yellow-50 px-4 py-2 rounded-full border border-yellow-100 flex items-center gap-2 shadow-sm">
                  <Coins size={20} className="text-yellow-500" />
                  <span className="font-black text-yellow-700 text-lg">{userCoins}</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200">
              <div className="mb-8">
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Your Nickname</label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter a cool name..."
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-lg font-bold focus:border-indigo-500 focus:outline-none transition-colors"
                />
              </div>

              <div className="mb-8">
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Game Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['classic', 'theme', 'speed'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSelectedMode(mode)}
                      className={cn(
                        "p-3 rounded-xl border-2 font-bold text-sm transition-all capitalize",
                        selectedMode === mode 
                          ? "border-indigo-600 bg-indigo-50 text-indigo-600 shadow-sm" 
                          : "border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200"
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-slate-400 font-medium italic">
                  {selectedMode === 'classic' && "Standard drawing and guessing. 60s rounds."}
                  {selectedMode === 'theme' && "Specific categories with bonus points! 80s rounds."}
                  {selectedMode === 'speed' && "Rapid fire rounds! Only 20s to draw."}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button 
                  onClick={quickPlay}
                  disabled={!playerName.trim()}
                  className="md:col-span-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white p-6 rounded-2xl font-black text-xl hover:from-indigo-700 hover:to-violet-700 transition-all shadow-lg flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  <Play fill="currentColor" size={24} />
                  Quick Play
                </button>
                <button 
                  onClick={() => createRoom()}
                  disabled={!playerName.trim()}
                  className="bg-white border-2 border-indigo-100 text-indigo-600 p-6 rounded-2xl font-bold hover:bg-indigo-50 transition-all flex flex-col items-center gap-2 disabled:opacity-50"
                >
                  <Plus size={32} />
                  <span>Create Room</span>
                </button>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Enter Room ID..."
                    className="w-full h-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 pr-16 font-bold focus:border-indigo-500 focus:outline-none transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && joinRoom((e.target as HTMLInputElement).value)}
                  />
                  <button className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-600 hover:text-indigo-800">
                    <LogIn size={24} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {view === 'lobby' && currentRoom && (
          <motion.div 
            key="lobby"
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="max-w-4xl mx-auto pt-12 px-4"
          >
            <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200">
              <div className="bg-indigo-600 p-8 text-white flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-black italic">{currentRoom.name}</h2>
                  <div className="flex items-center gap-2 text-indigo-100 opacity-80 font-medium">
                    <span>Room ID: {currentRoom.id}</span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(currentRoom.id);
                        showToast('Room ID copied to clipboard!');
                      }}
                      className="hover:text-white transition-colors"
                      title="Copy Room ID"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    </button>
                  </div>
                </div>
                <div className="bg-white/20 px-4 py-2 rounded-full font-bold flex items-center gap-2">
                  <span className="capitalize">{currentRoom.mode} Mode</span>
                </div>
                <div className="bg-white/20 px-4 py-2 rounded-full font-bold flex items-center gap-2">
                  <Crown size={18} className="text-amber-300" />
                  Lobby
                </div>
              </div>

              <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-2">
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    Players ({players.length})
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {players.map(p => (
                      <div key={p.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col items-center gap-2">
                        <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                          <User size={24} />
                        </div>
                        <span className="font-bold text-slate-700 truncate w-full text-center">{p.name}</span>
                        {p.isHost && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold uppercase">Host</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col justify-end gap-4">
                  {players.find(p => p.id === user.uid)?.isHost ? (
                    <button 
                      onClick={startGame}
                      disabled={players.length < 2}
                      className="w-full bg-indigo-600 text-white p-6 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg disabled:opacity-50"
                    >
                      Start Game
                    </button>
                  ) : (
                    <div className="bg-slate-100 p-6 rounded-2xl text-center text-slate-500 font-medium">
                      Waiting for host to start...
                    </div>
                  )}
                  <button 
                    onClick={() => setView('landing')}
                    className="w-full bg-slate-100 text-slate-600 p-4 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                  >
                    Leave Room
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {view === 'game' && currentRoom && (
          <motion.div 
            key="game"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="h-screen flex flex-col p-4 gap-4"
          >
            {/* Game Header */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mode</span>
                  <span className="text-sm font-black text-indigo-400 capitalize">{currentRoom.mode}</span>
                </div>
                <div className="h-10 w-px bg-slate-100" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Round</span>
                  <span className="text-xl font-black text-indigo-600">{currentRoom.currentRound} / {currentRoom.totalRounds}</span>
                </div>
                <div className="h-10 w-px bg-slate-100" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time Left</span>
                  <span className={cn("text-xl font-black", currentRoom.timeLeft < 10 ? "text-rose-500 animate-pulse" : "text-slate-800")}>
                    {currentRoom.timeLeft}s
                  </span>
                </div>
              </div>

              <div className="flex-1 text-center">
                {user.uid === currentRoom.currentDrawerId ? (
                  <div className="inline-block bg-indigo-50 px-6 py-2 rounded-full border border-indigo-100">
                    <span className="text-xs font-bold text-indigo-400 uppercase mr-2">Draw:</span>
                    <span className="text-xl font-black text-indigo-700 tracking-widest uppercase">{currentRoom.currentWord}</span>
                  </div>
                ) : (
                  <div className="inline-block bg-slate-50 px-6 py-2 rounded-full border border-slate-100">
                    <span className="text-xs font-bold text-slate-400 uppercase mr-2">Guess the word:</span>
                    <span className="text-xl font-black text-slate-800 tracking-widest">
                      {currentRoom.currentWord.split('').map((c, i) => (c === ' ' ? ' ' : '_')).join(' ')}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                <div className="bg-yellow-50 px-4 py-2 rounded-full border border-yellow-100 flex items-center gap-2">
                  <Coins size={16} className="text-yellow-500" />
                  <span className="font-bold text-yellow-700">{players.find(p => p.id === user.uid)?.coins || 0}</span>
                </div>
              </div>
            </div>

            {/* Game Body */}
            <div className="flex-1 flex gap-4 overflow-hidden">
              {/* Sidebar Left */}
              <div className="w-64 flex flex-col gap-4">
                <PlayerList players={players} currentDrawerId={currentRoom.currentDrawerId} />
                
                {user.uid === currentRoom.currentDrawerId && (
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Tools</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setTool('pen')}
                        className={cn("p-2 rounded-lg flex items-center justify-center gap-2 text-sm font-bold transition-all", tool === 'pen' ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100")}
                      >
                        <Palette size={16} /> Pen
                      </button>
                      <button 
                        onClick={() => setTool('eraser')}
                        className={cn("p-2 rounded-lg flex items-center justify-center gap-2 text-sm font-bold transition-all", tool === 'eraser' ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100")}
                      >
                        <Eraser size={16} /> Eraser
                      </button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                        <span>Color</span>
                        <span className="text-slate-800">{brushColor}</span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {['#000000', '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'].map(c => (
                          <button 
                            key={c}
                            onClick={() => { setBrushColor(c); setTool('pen'); }}
                            className={cn("w-6 h-6 rounded-full border-2", brushColor === c ? "border-indigo-600 scale-110" : "border-transparent")}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDraw([])}
                      className="w-full bg-rose-50 text-rose-600 p-2 rounded-lg text-xs font-bold hover:bg-rose-100 transition-all flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} /> Clear Canvas
                    </button>
                  </div>
                )}
              </div>

              {/* Canvas Area */}
              <div className="flex-1 relative">
                <Canvas 
                  lines={drawingLines}
                  onDraw={handleDraw}
                  isReadOnly={user.uid !== currentRoom.currentDrawerId}
                  color={brushColor}
                  strokeWidth={brushWidth}
                />
              </div>

              {/* Sidebar Right */}
              <div className="w-80">
                <Chat 
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  currentUserEmail={user.email}
                  isDrawer={user.uid === currentRoom.currentDrawerId}
                />
              </div>
            </div>
          </motion.div>
        )}

        {view === 'results' && currentRoom && (
          <motion.div 
            key="results"
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="max-w-2xl mx-auto pt-20 px-4 text-center"
          >
            <div className="bg-white p-12 rounded-3xl shadow-2xl border border-slate-200">
              <Trophy size={80} className="text-amber-400 mx-auto mb-6" />
              <h1 className="text-4xl font-black text-slate-800 mb-2">Game Over!</h1>
              <p className="text-slate-500 mb-8">Here's how everyone did</p>

              <div className="space-y-4 mb-12">
                {players.sort((a, b) => b.score - a.score).map((p, i) => (
                  <div key={p.id} className={cn("flex items-center justify-between p-4 rounded-2xl", i === 0 ? "bg-amber-50 border border-amber-100" : "bg-slate-50")}>
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-black text-slate-300 w-8">#{i + 1}</span>
                      <span className="font-bold text-slate-800">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Score</span>
                        <span className="font-black text-indigo-600">{p.score}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Coins</span>
                        <span className="font-black text-yellow-600">+{p.coins}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mb-8 p-4 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-center justify-center gap-3">
                <Coins size={24} className="text-yellow-500" />
                <span className="text-indigo-900 font-bold">Total Persistent Coins: <span className="text-xl font-black">{userCoins}</span></span>
              </div>

              <button 
                onClick={() => setView('landing')}
                className="w-full bg-indigo-600 text-white p-6 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg"
              >
                Back to Menu
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl font-bold text-sm z-50 flex items-center gap-2"
          >
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </ErrorBoundary>
  );
}

function User({ size, className }: { size?: number, className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size || 24} 
      height={size || 24} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
