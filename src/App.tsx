/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  runTransaction,
  getDocFromServer
} from 'firebase/firestore';

import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { db, auth } from './firebase';
import { Room, Player, Message, DrawingLine, UserProfile } from './types';
import { WORD_LIST, THEME_WORDS, MODE_CONFIG, ROUND_TIME, TOTAL_ROUNDS, POINTS_PER_GUESS, COINS_PER_GUESS, AVATARS } from './constants';
import { getWordPoints } from './botDrawing';
import { Canvas } from './components/Canvas';
import { Chat } from './components/Chat';
import { PlayerList } from './components/PlayerList';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, LogIn, Trophy, Coins, Palette, Eraser, Trash2, Play, Crown, Loader2, AlertCircle, ShoppingBag, Clock, Zap, X, User as UserIcon, Music, CheckCircle, Edit2, Save, Star, LogOut, Settings, Info, Heart, ExternalLink } from 'lucide-react';
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
const ADJECTIVES = ["Neon", "Cyber", "Digital", "Quantum", "Hyper", "Virtual", "Binary", "Pixel"];
const NOUNS = ["Nexus", "Void", "Grid", "Matrix", "Circuit", "Node", "Core", "Link"];

const SOUNDS = {
  TECH: "https://www.soundjay.com/buttons/sounds/button-16.mp3",
  WINNER: "https://www.soundjay.com/human/sounds/cheering-01.mp3",
  CLICK: "https://www.soundjay.com/buttons/sounds/button-3.mp3",
  CORRECT: "https://www.soundjay.com/buttons/sounds/button-09.mp3",
  POWERUP: "https://www.soundjay.com/buttons/sounds/button-11.mp3",
  ROUND_START: "https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3",
  BGM: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
};

const audioCache: Record<string, HTMLAudioElement> = {};

const bgmAudio = new Audio(SOUNDS.BGM);
bgmAudio.loop = true;
bgmAudio.preload = 'auto';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [playerName, setPlayerName] = useState('');

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drawingLines, setDrawingLines] = useState<DrawingLine[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'landing' | 'lobby' | 'game' | 'results' | 'shop' | 'profile' | 'settings'>('landing');
  const [previousView, setPreviousView] = useState<'landing' | 'lobby' | 'game' | 'results' | 'profile' | 'settings'>('landing');
  const [userCoins, setUserCoins] = useState(0);
  const [userInventory, setUserInventory] = useState({ freeze: 0, hint: 0, reveal: 0, skip: 0 });
  const [userStats, setUserStats] = useState({ wins: 0, totalPoints: 0, gamesPlayed: 0 });
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [isBgmEnabled, setIsBgmEnabled] = useState(false);
  const [bgmVolume, setBgmVolume] = useState(0.3);
  const [sfxVolume, setSfxVolume] = useState(0.5);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const playSound = (url: string) => {
    try {
      if (!audioCache[url]) {
        audioCache[url] = new Audio(url);
      }
      const audio = audioCache[url];
      audio.currentTime = 0;
      audio.volume = sfxVolume;
      audio.play().catch(e => console.warn("Audio play blocked or failed:", e));
    } catch (e) {
      console.error("Sound error:", e);
    }
  };
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [revealedLetters, setRevealedLetters] = useState<Record<number, string>>({});
  const drawingLinesRef = useRef<DrawingLine[]>([]);

  useEffect(() => {
    drawingLinesRef.current = drawingLines;
  }, [drawingLines]);
  
  // Drawing state
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushWidth, setBrushWidth] = useState(5);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [selectedMode, setSelectedMode] = useState<'classic' | 'theme' | 'speed'>('classic');
  const [resultsCountdown, setResultsCountdown] = useState(20);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('Loading assets...');
  const [isAppReady, setIsAppReady] = useState(false);
  const [hasUpdatedStats, setHasUpdatedStats] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const toggleBgm = () => {
    const nextState = !isBgmEnabled;
    setIsBgmEnabled(nextState);
    
    if (nextState) {
      bgmAudio.play().catch(e => {
        console.warn("BGM play failed:", e);
      });
    } else {
      bgmAudio.pause();
    }
    playSound(SOUNDS.CLICK);
  };

  // Loading simulation
  useEffect(() => {
    if (!loading) return;

    const texts = [
      'Loading assets...',
      'Loading files...',
      'Initializing database...',
      'Connecting to server...',
      'Preparing canvas...',
      'Ready!'
    ];

    let currentProgress = 0;
    const interval = setInterval(() => {
      // High speed loading simulation
      const increment = currentProgress < 50 ? Math.random() * 10 + 5 : Math.random() * 25 + 10;
      currentProgress = Math.min(100, currentProgress + increment);
      
      setLoadingProgress(currentProgress);
      
      // Play tech sound on progress - more frequent
      if (Math.random() < 0.5) playSound(SOUNDS.TECH);
      
      const textIndex = Math.min(texts.length - 1, Math.floor((currentProgress / 100) * (texts.length - 0.1)));
      setLoadingText(texts[textIndex]);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setIsAppReady(true);
        }, 100);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [loading]);

  // BGM Control
  useEffect(() => {
    bgmAudio.volume = bgmVolume;
    
    if (isBgmEnabled) {
      bgmAudio.play().catch(() => {});
    } else {
      bgmAudio.pause();
    }
  }, [isBgmEnabled, bgmVolume]);

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
    
    if (currentRoom.hostId !== user.uid) return;

    // Start immediately for Quick Play
    startGame();
  }, [currentRoom?.id, currentRoom?.status, currentRoom?.isQuickPlay, user]);

  // Persistent User Data Listener
  useEffect(() => {
    if (!user) {
      setUserCoins(0);
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    const unsubUser = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setUserCoins(data.totalCoins || 0);
        setUserInventory(data.inventory || { freeze: 0, hint: 0, reveal: 0, skip: 0 });
        setUserStats(data.stats || { wins: 0, totalPoints: 0, gamesPlayed: 0 });
        setAvatarUrl(data.avatarUrl);
        if (data.displayName && !playerName) {
          setPlayerName(data.displayName);
        }
      } else {
        // Initialize user doc if it doesn't exist
        const initialName = user.displayName || 'Anonymous';
        setPlayerName(initialName);
        setDoc(userRef, {
          displayName: initialName,
          totalCoins: 0,
          inventory: { freeze: 0, hint: 0, reveal: 0, skip: 0 },
          stats: { wins: 0, totalPoints: 0, gamesPlayed: 0 },
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

  // Results countdown logic
  useEffect(() => {
    if (view !== 'results') {
      setResultsCountdown(20);
      return;
    }

    const timer = setInterval(() => {
      setResultsCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setView('landing');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [view]);

  // Stats tracking on game finish
  useEffect(() => {
    if (view === 'results' && currentRoom && !hasUpdatedStats && user) {
      const updateStats = async () => {
        const userRef = doc(db, 'users', user.uid);
        const currentPlayer = players.find(p => p.id === user.uid);
        if (!currentPlayer) return;

        // Determine if won
        const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
        const isWinner = sortedPlayers[0]?.id === user.uid;

        try {
          await runTransaction(db, async (transaction) => {
            const uSnap = await transaction.get(userRef);
            if (!uSnap.exists()) return;
            const uData = uSnap.data();
            const stats = uData.stats || { wins: 0, totalPoints: 0, gamesPlayed: 0 };
            
            transaction.update(userRef, {
              stats: {
                wins: stats.wins + (isWinner ? 1 : 0),
                totalPoints: stats.totalPoints + currentPlayer.score,
                gamesPlayed: stats.gamesPlayed + 1
              }
            });
          });
          setHasUpdatedStats(true);
        } catch (e) {
          console.error("Failed to update stats:", e);
        }
      };
      updateStats();
    } else if (view !== 'results') {
      setHasUpdatedStats(false);
    }
  }, [view, currentRoom?.id, user, players]);

  useEffect(() => {
    if (view === 'results') {
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      playSound(SOUNDS.WINNER);
    }
  }, [view]);

  // Timer logic (only for host)
  useEffect(() => {
    if (!currentRoom || currentRoom.status !== 'playing' || !user) return;
    
    if (currentRoom.hostId !== user.uid) return;

    const interval = setInterval(async () => {
      if (currentRoom.timeLeft > 0) {
        // Update every 2 seconds to save quota
        await updateDoc(doc(db, 'rooms', currentRoom.id), {
          timeLeft: Math.max(0, currentRoom.timeLeft - 2)
        });
      } else {
        // Round ended
        handleRoundEnd();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentRoom, players, user]);

  // Bot logic (only for host)
  const botDrawingStepRef = useRef<number>(0);
  const lastBotWordRef = useRef<string>('');

  useEffect(() => {
    if (!currentRoom || currentRoom.status !== 'playing' || !user) return;
    if (currentRoom.hostId !== user.uid) return;

    const bots = players.filter(p => p.isBot);
    if (bots.length === 0) return;

    // Reset drawing step if word changes
    if (currentRoom.currentWord !== lastBotWordRef.current) {
      botDrawingStepRef.current = 0;
      lastBotWordRef.current = currentRoom.currentWord;
    }

    const botInterval = setInterval(async () => {
      const drawerBot = bots.find(b => b.id === currentRoom.currentDrawerId);
      const guessingBots = bots.filter(b => b.id !== currentRoom.currentDrawerId && !b.hasGuessedCorrectly);

      // Bot Drawing (if a bot is the drawer)
      if (drawerBot) {
        const word = currentRoom.currentWord;
        // Center the drawing
        const wordWidth = word.length * 120 * 1.2;
        const startX = Math.max(50, (1000 - wordWidth) / 2);
        const startY = 400;
        const allLines = getWordPoints(word, startX, startY, 1000, 800);
        
        if (botDrawingStepRef.current < allLines.length) {
          const linePoints = allLines[botDrawingStepRef.current];
          const newLine: DrawingLine = {
            tool: 'pen',
            points: linePoints,
            color: '#000000',
            strokeWidth: 6
          };
          const updatedLines = [...drawingLinesRef.current, newLine];
          await handleDraw(updatedLines);
          botDrawingStepRef.current++;
        }
      }

      // Bot Guessing (one random guessing bot per interval)
      if (guessingBots.length > 0 && Math.random() < 0.4) {
        const activeBot = guessingBots[Math.floor(Math.random() * guessingBots.length)];
        
        // 25% chance to guess correctly
        const shouldGuessCorrect = Math.random() < 0.25;
        if (shouldGuessCorrect) {
          await handleBotGuess(activeBot, currentRoom.currentWord);
        } else {
          const randomGuesses = [
            "Is it a cat?", "Looks like a tree", "Maybe a house?", "I don't know!", 
            "Cool drawing!", "What is that?", "Interesting...", "Hmm...", 
            "Wait, I know!", "Is it a dog?", "A bird?", "A car?", "A plane?",
            "Super cool!", "I'm close!", "Almost got it!", "Is it food?"
          ];
          await handleBotGuess(activeBot, randomGuesses[Math.floor(Math.random() * randomGuesses.length)]);
        }
      }
    }, 1000); // Faster interval for smoother drawing

    return () => clearInterval(botInterval);
  }, [currentRoom?.id, currentRoom?.status, currentRoom?.currentDrawerId, currentRoom?.hostId, currentRoom?.currentWord, players, user]);

  const handleBotGuess = async (bot: Player, text: string) => {
    if (!currentRoom) return;
    
    const normalizedGuess = text.trim().toLowerCase();
    const normalizedWord = currentRoom.currentWord.trim().toLowerCase();
    const isCorrect = normalizedGuess === normalizedWord;
    
    if (isCorrect && !bot.hasGuessedCorrectly) {
      await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
        senderId: 'system',
        senderName: 'System',
        text: `${bot.name} guessed the word!`,
        type: 'guess',
        createdAt: serverTimestamp()
      });

      // Stop timer to end round immediately
      await updateDoc(doc(db, 'rooms', currentRoom.id), { timeLeft: 0 });

      const botRef = doc(db, 'rooms', currentRoom.id, 'players', bot.id);
      const config = MODE_CONFIG[currentRoom.mode];
      await updateDoc(botRef, {
        score: bot.score + Math.round(POINTS_PER_GUESS * config.pointsMultiplier),
        coins: bot.coins + Math.round(COINS_PER_GUESS * config.pointsMultiplier),
        hasGuessedCorrectly: true
      });
    } else if (!isCorrect) {
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

    // Reveal the word to everyone
    await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
      senderId: 'system',
      senderName: 'System',
      text: `The word was: ${currentRoom.currentWord}`,
      type: 'system',
      createdAt: serverTimestamp()
    });
    
    const config = MODE_CONFIG[currentRoom.mode];
    const nextRound = currentRoom.currentRound + 1;
    if (nextRound > config.totalRounds) {
      await updateDoc(doc(db, 'rooms', currentRoom.id), { status: 'finished' });
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

      // Reset hasGuessedCorrectly for all players
      const playersRef = collection(db, 'rooms', currentRoom.id, 'players');
      const playersSnap = await getDocs(playersRef);
      const batch = playersSnap.docs.map(playerDoc => 
        updateDoc(doc(db, 'rooms', currentRoom.id, 'players', playerDoc.id), {
          hasGuessedCorrectly: false
        })
      );
      await Promise.all(batch);

      setRevealedLetters({}); // Clear revealed letters for new round
      playSound(SOUNDS.ROUND_START);
      botDrawingStepRef.current = 0;

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

      const roomData = roomSnap.data() as Room;
      const isHost = roomData.hostId === user.uid;

      const playerRef = doc(db, 'rooms', roomId, 'players', user.uid);
      await setDoc(playerRef, {
        name: playerName,
        avatarUrl: avatarUrl || null,
        score: 0,
        coins: 0,
        isReady: isHost,
        isHost: isHost,
        lastActive: new Date().toISOString()
      });

      setCurrentRoom({ ...roomData, id: roomId });
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
      const roomName = withBots 
        ? `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${NOUNS[Math.floor(Math.random() * NOUNS.length)]} ${Math.floor(Math.random() * 999)}`
        : `${playerName}'s Room`;
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
        avatarUrl: avatarUrl || null,
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
            name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
            score: 0,
            coins: 0,
            isReady: true,
            isHost: false,
            isBot: true,
            lastActive: new Date().toISOString()
          };
          await setDoc(doc(db, 'rooms', roomRef.id, 'players', botId), botData);
          botPlayers.push({ ...botData, id: botId });
        }
      }

      const finalRoom = { ...roomData, id: roomRef.id } as unknown as Room;
      setCurrentRoom(finalRoom);
      
      if (autoStart) {
        // We need the players list to start the game
        const allPlayers = [{ id: user.uid, name: playerName, score: 0, coins: 0, isReady: true, isHost: true, lastActive: new Date().toISOString() }, ...botPlayers];
        await startGameInternal(finalRoom, allPlayers);
        setView('game'); // Immediate transition for Quick Play
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

    botDrawingStepRef.current = 0;

    await addDoc(collection(db, 'rooms', room.id, 'messages'), {
      senderId: 'system',
      senderName: 'System',
      text: `Game started! ${firstDrawer.name} is drawing.`,
      type: 'system',
      createdAt: serverTimestamp()
    });
  };

  const lastDrawTimeRef = useRef<number>(0);
  const handleDraw = async (lines: DrawingLine[]) => {
    if (!currentRoom || !user) return;
    
    // Only the current drawer should be able to draw
    const isDrawer = user.uid === currentRoom.currentDrawerId;
    const isHostForBot = currentRoom.hostId === user.uid && players.find(p => p.id === currentRoom.currentDrawerId)?.isBot;

    if (!isDrawer && !isHostForBot) return;

    // Throttle writes to every 300ms to save quota
    const now = Date.now();
    if (now - lastDrawTimeRef.current < 300 && lines.length > 0) return;
    lastDrawTimeRef.current = now;

    await setDoc(doc(db, 'rooms', currentRoom.id, 'drawing', 'current'), {
      lines: JSON.stringify(lines),
      updatedAt: serverTimestamp()
    });
  };

  const updatePlayerName = async (newName: string) => {
    if (!user || !newName.trim()) return;
    setPlayerName(newName);
    
    // Update in users collection
    const userRef = doc(db, 'users', user.uid);
    await updateDoc(userRef, { displayName: newName }).catch(() => {});

    // Update in current room if in one
    if (currentRoom) {
      const playerRef = doc(db, 'rooms', currentRoom.id, 'players', user.uid);
      await updateDoc(playerRef, { name: newName }).catch(() => {});
    }
  };

  const handleUpdateProfile = async () => {
    if (!user || !editName.trim()) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: editName.trim(),
        avatarUrl: editAvatar.trim()
      });
      
      setPlayerName(editName.trim());
      setAvatarUrl(editAvatar.trim());
      
      // Update in current room if in one
      if (currentRoom) {
        const playerRef = doc(db, 'rooms', currentRoom.id, 'players', user.uid);
        await updateDoc(playerRef, { 
          name: editName.trim(),
          avatarUrl: editAvatar.trim() 
        }).catch(() => {});
      }
      
      setIsEditingProfile(false);
      showToast('Profile updated successfully!', 'success');
    } catch (e) {
      console.error("Failed to update profile:", e);
      showToast('Failed to update profile', 'error');
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!currentRoom || !user) return;

    const normalizedGuess = text.trim().toLowerCase();
    const normalizedWord = currentRoom.currentWord.trim().toLowerCase();
    const isCorrect = normalizedGuess === normalizedWord;
    const isDrawer = user.uid === currentRoom.currentDrawerId;
    const currentPlayer = players.find(p => p.id === user.uid);

    if (isCorrect && !isDrawer && currentRoom.status === 'playing' && !currentPlayer?.hasGuessedCorrectly) {
      // Correct guess!
      playSound(SOUNDS.CORRECT);
      await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
        senderId: 'system',
        senderName: 'System',
        text: `${playerName} guessed the word!`,
        type: 'guess',
        createdAt: serverTimestamp()
      });

      // Stop timer to end round immediately
      await updateDoc(doc(db, 'rooms', currentRoom.id), { timeLeft: 0 });

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
            score: (data.score || 0) + earnedPoints,
            coins: (data.coins || 0) + earnedCoins,
            hasGuessedCorrectly: true
          });
        }

        const currentTotalCoins = uSnap.exists() ? (uSnap.data().totalCoins || 0) : 0;
        transaction.set(userRef, {
          totalCoins: currentTotalCoins + earnedCoins,
          lastActive: serverTimestamp(),
          displayName: playerName || user.displayName || 'Anonymous'
        }, { merge: true });
      });
    } else if (currentPlayer?.hasGuessedCorrectly && isCorrect) {
      // Already guessed, don't send message or just send as chat
      return;
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
      // Always create a fresh Quick Play room for immediate start and random name
      await createRoom(true, true);
    } catch (e) {
      console.error(e);
      showToast("Failed to start Quick Play");
    } finally {
      setLoading(false);
    }
  };

  const buyPowerup = async (type: 'freeze' | 'hint' | 'reveal' | 'skip') => {
    if (!user) return;
    
    const costs = { freeze: 500, hint: 200, reveal: 300, skip: 250 };
    const cost = costs[type];

    if (userCoins < cost) {
      showToast("Not enough coins!");
      return;
    }

    const isPlaying = currentRoom && currentRoom.status === 'playing';

    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', user.uid);
        const uSnap = await transaction.get(userRef);
        if (!uSnap.exists()) throw new Error("User profile not found");
        
        const uData = uSnap.data();
        if ((uData.totalCoins || 0) < cost) throw new Error("Not enough coins");

        const newInventory = { ...(uData.inventory || { freeze: 0, hint: 0, reveal: 0, skip: 0 }) };

        if (isPlaying) {
          const roomRef = doc(db, 'rooms', currentRoom.id);
          const rSnap = await transaction.get(roomRef);
          if (!rSnap.exists()) throw new Error("Room not found");
          const rData = rSnap.data();

          if (type === 'freeze') {
            transaction.update(roomRef, {
              timeLeft: (rData.timeLeft || 0) + 15
            });
          } else if (type === 'skip') {
            if (user.uid !== rData.currentDrawerId) {
              throw new Error("Only the drawer can skip the word");
            }
            
            let nextWord = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
            transaction.update(roomRef, {
              currentWord: nextWord
            });
          }
        } else {
          // Add to inventory if not in game
          newInventory[type] = (newInventory[type] || 0) + 1;
        }

        transaction.update(userRef, {
          totalCoins: uData.totalCoins - cost,
          inventory: newInventory
        });
      });

      // Handle side effects outside transaction
      if (isPlaying) {
        playSound(SOUNDS.POWERUP);
        if (type === 'freeze') {
          await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
            senderId: 'system',
            senderName: 'System',
            text: `${playerName} used Time Freeze! +15s`,
            type: 'system',
            createdAt: serverTimestamp()
          });
        } else if (type === 'hint') {
          const word = currentRoom.currentWord;
          const unrevealedIndices = [];
          for (let i = 0; i < word.length; i++) {
            if (word[i] !== ' ' && !revealedLetters[i]) {
              unrevealedIndices.push(i);
            }
          }
          
          if (unrevealedIndices.length > 0) {
            const hintIndex = unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)];
            const hintChar = word[hintIndex];
            setRevealedLetters(prev => ({ ...prev, [hintIndex]: hintChar }));
            showToast(`Hint: The word has '${hintChar}' at position ${hintIndex + 1}`);
          } else {
            showToast("All letters already revealed!");
          }
        } else if (type === 'reveal') {
          const word = currentRoom.currentWord;
          let category = "General";
          for (const [cat, words] of Object.entries(THEME_WORDS)) {
            if (words.includes(word)) {
              category = cat;
              break;
            }
          }
          showToast(`Category: This word is related to ${category}`);
        } else if (type === 'skip') {
          setRevealedLetters({});
          await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
            senderId: 'system',
            senderName: 'System',
            text: `${playerName} skipped the word and got a new one!`,
            type: 'system',
            createdAt: serverTimestamp()
          });
        }
        showToast("Power-up activated!");
      } else {
        showToast("Power-up added to inventory!");
      }
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : "Failed to buy power-up");
    }
  };

  const usePowerup = async (type: 'freeze' | 'hint' | 'reveal' | 'skip') => {
    if (!user || !currentRoom || currentRoom.status !== 'playing') return;
    
    if ((userInventory[type] || 0) <= 0) {
      showToast(`No ${type} power-ups in inventory!`);
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', user.uid);
        const uSnap = await transaction.get(userRef);
        if (!uSnap.exists()) throw new Error("User profile not found");
        
        const uData = uSnap.data();
        const inv = uData.inventory || { freeze: 0, hint: 0, reveal: 0, skip: 0 };
        if ((inv[type] || 0) <= 0) throw new Error("No charges left");

        const roomRef = doc(db, 'rooms', currentRoom.id);
        const rSnap = await transaction.get(roomRef);
        if (!rSnap.exists()) throw new Error("Room not found");
        const rData = rSnap.data();

        const newInventory = { ...inv };
        newInventory[type] = inv[type] - 1;

        transaction.update(userRef, { inventory: newInventory });

        if (type === 'freeze') {
          transaction.update(roomRef, {
            timeLeft: (rData.timeLeft || 0) + 15
          });
        } else if (type === 'skip') {
          if (user.uid !== rData.currentDrawerId) {
            throw new Error("Only the drawer can skip the word");
          }
          
          let nextWord = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
          transaction.update(roomRef, {
            currentWord: nextWord
          });
        }
      });

      // Handle side effects
      playSound(SOUNDS.POWERUP);
      if (type === 'freeze') {
        await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
          senderId: 'system',
          senderName: 'System',
          text: `${playerName} used Time Freeze! +15s`,
          type: 'system',
          createdAt: serverTimestamp()
        });
      } else if (type === 'hint') {
        const word = currentRoom.currentWord;
        // Find indices that haven't been revealed yet
        const unrevealedIndices = [];
        for (let i = 0; i < word.length; i++) {
          if (word[i] !== ' ' && !revealedLetters[i]) {
            unrevealedIndices.push(i);
          }
        }
        
        if (unrevealedIndices.length > 0) {
          const hintIndex = unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)];
          const hintChar = word[hintIndex];
          setRevealedLetters(prev => ({ ...prev, [hintIndex]: hintChar }));
          showToast(`Hint: The word has '${hintChar}' at position ${hintIndex + 1}`);
        } else {
          showToast("All letters already revealed!");
        }
      } else if (type === 'reveal') {
        const word = currentRoom.currentWord;
        let category = "General";
        for (const [cat, words] of Object.entries(THEME_WORDS)) {
          if (words.includes(word)) {
            category = cat;
            break;
          }
        }
        showToast(`Category: This word is related to ${category}`);
      } else if (type === 'skip') {
        setRevealedLetters({});
        await addDoc(collection(db, 'rooms', currentRoom.id, 'messages'), {
          senderId: 'system',
          senderName: 'System',
          text: `${playerName} used Skip Word!`,
          type: 'system',
          createdAt: serverTimestamp()
        });
      }

      showToast("Power-up used!");
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : "Failed to use power-up");
    }
  };

  if (loading || !isAppReady) {
    return (
      <div className="min-h-screen bg-indigo-600 flex flex-col items-center justify-center text-white p-8">
        <div className="w-full max-w-md flex flex-col items-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mb-8 relative"
          >
            <div className="absolute inset-0 bg-white/20 blur-2xl rounded-full" />
            <img 
              src="https://picsum.photos/seed/devduo/200/200" 
              alt="Dev Duo Logo" 
              className="w-32 h-32 rounded-3xl shadow-2xl relative z-10 border-4 border-white/20"
              referrerPolicy="no-referrer"
            />
          </motion.div>

          <h1 className="text-4xl font-black mb-8 text-center italic tracking-tighter">ZOODLE</h1>
          
          <div className="w-full mb-2 flex justify-between items-end">
            <span className="text-sm font-bold uppercase tracking-widest opacity-80">Loading...</span>
            <span className="text-2xl font-black">{Math.floor(loadingProgress)}%</span>
          </div>
          
          <div className="w-full h-3 bg-indigo-800 rounded-full overflow-hidden mb-4 shadow-inner">
            <motion.div 
              className="h-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.5)]"
              initial={{ width: 0 }}
              animate={{ width: `${loadingProgress}%` }}
              transition={{ type: 'spring', bounce: 0, duration: 0.2 }}
            />
          </div>
          
          <p className="text-center text-indigo-200 font-medium animate-pulse">
            {loadingText}
          </p>
        </div>
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
          <h1 className="text-4xl font-black text-slate-900 mb-2 italic">ZOODLE</h1>
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
        {view === 'profile' && (
          <motion.div 
            key="profile"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-2xl mx-auto pt-20 px-4"
          >
            <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-black text-slate-900 italic uppercase">User Profile</h2>
                <div className="flex items-center gap-2">
                  {!isEditingProfile ? (
                    <button 
                      onClick={() => {
                        setEditName(playerName);
                        setEditAvatar(avatarUrl || '');
                        setIsEditingProfile(true);
                        playSound(SOUNDS.CLICK);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-colors"
                    >
                      <Edit2 size={18} />
                      Edit Profile
                    </button>
                  ) : (
                    <button 
                      onClick={() => setIsEditingProfile(false)}
                      className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setIsEditingProfile(false);
                      setView(previousView);
                    }}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-8 mb-8">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative group">
                    {(isEditingProfile ? editAvatar : avatarUrl) ? (
                      <img 
                        src={isEditingProfile ? editAvatar : avatarUrl} 
                        alt="Avatar" 
                        className="w-32 h-32 rounded-full border-4 border-indigo-100 object-cover shadow-lg"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-32 h-32 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-300 border-4 border-indigo-100 shadow-lg">
                        <UserIcon size={64} />
                      </div>
                    )}
                  </div>
                  {!isEditingProfile && (
                    <div className="text-center">
                      <h3 className="text-2xl font-black text-slate-800">{playerName}</h3>
                      <p className="text-slate-400 text-sm font-medium">{user?.email}</p>
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-6">
                  {isEditingProfile ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Display Name</label>
                        <input 
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold focus:border-indigo-500 outline-none transition-all"
                          placeholder="Your Name"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">Avatar URL</label>
                        <input 
                          type="text"
                          value={editAvatar}
                          onChange={(e) => setEditAvatar(e.target.value)}
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold focus:border-indigo-500 outline-none transition-all"
                          placeholder="https://example.com/avatar.png"
                        />
                        <p className="text-[10px] text-slate-400 mt-1 ml-1">Use a direct link to an image or choose from presets below</p>
                      </div>
                      
                      <div className="pt-2">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2 ml-1">Presets</label>
                        <div className="grid grid-cols-5 gap-2">
                          {AVATARS.map((url, i) => (
                            <button
                              key={i}
                              onClick={() => setEditAvatar(url)}
                              className={cn(
                                "aspect-square rounded-lg border-2 transition-all overflow-hidden",
                                editAvatar === url ? "border-indigo-600 scale-105" : "border-slate-100 opacity-60"
                              )}
                            >
                              <img src={url} alt={`Avatar ${i}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            </button>
                          ))}
                        </div>
                      </div>

                      <button 
                        onClick={handleUpdateProfile}
                        className="w-full bg-indigo-600 text-white p-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg flex items-center justify-center gap-2"
                      >
                        <Save size={20} />
                        Save Changes
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-indigo-50 p-4 rounded-2xl text-center border border-indigo-100">
                          <Trophy className="w-6 h-6 text-indigo-600 mx-auto mb-1" />
                          <div className="text-xl font-black text-indigo-700">{userStats.wins}</div>
                          <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Wins</div>
                        </div>
                        <div className="bg-amber-50 p-4 rounded-2xl text-center border border-amber-100">
                          <Zap className="w-6 h-6 text-amber-600 mx-auto mb-1" />
                          <div className="text-xl font-black text-amber-700">{userStats.totalPoints}</div>
                          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Points</div>
                        </div>
                        <div className="bg-emerald-50 p-4 rounded-2xl text-center border border-emerald-100">
                          <Play className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                          <div className="text-xl font-black text-emerald-700">{userStats.gamesPlayed}</div>
                          <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Games</div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                              <Star size={20} />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-400 uppercase">Current Level</div>
                              <div className="font-black text-slate-700">Level {Math.floor(userStats.totalPoints / 1000) + 1}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-slate-400 uppercase">Next Level</div>
                            <div className="font-black text-indigo-600">{1000 - (userStats.totalPoints % 1000)} XP</div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100">
                <button 
                  onClick={() => auth.signOut()}
                  className="w-full bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold hover:bg-rose-50 hover:text-rose-600 transition-all flex items-center justify-center gap-2"
                >
                  <LogIn size={20} className="rotate-180" />
                  Sign Out
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {view === 'shop' && (
          <motion.div 
            key="shop"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-2xl mx-auto pt-20 px-4"
          >
            <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-black text-slate-900 italic">POWER-UP SHOP</h2>
                <button 
                  onClick={() => setView(previousView)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 rounded-2xl border-2 border-indigo-50 bg-indigo-50/30 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                        <Clock size={24} />
                      </div>
                      <div className="bg-indigo-600 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase">
                        Owned: {userInventory.freeze}
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Time Freeze</h3>
                    <p className="text-sm text-slate-500 mb-4">Add 15 seconds to the current round timer.</p>
                  </div>
                  <button 
                    onClick={() => buyPowerup('freeze')}
                    className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Coins size={16} /> 500
                  </button>
                </div>

                <div className="p-6 rounded-2xl border-2 border-amber-50 bg-amber-50/30 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                        <Zap size={24} />
                      </div>
                      <div className="bg-amber-600 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase">
                        Owned: {userInventory.hint}
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Word Hint</h3>
                    <p className="text-sm text-slate-500 mb-4">Reveal a random letter of the current word.</p>
                  </div>
                  <button 
                    onClick={() => buyPowerup('hint')}
                    className="w-full bg-amber-500 text-white py-3 rounded-xl font-bold hover:bg-amber-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Coins size={16} /> 200
                  </button>
                </div>

                <div className="p-6 rounded-2xl border-2 border-emerald-50 bg-emerald-50/30 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                        <Palette size={24} />
                      </div>
                      <div className="bg-emerald-600 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase">
                        Owned: {userInventory.reveal}
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Category Reveal</h3>
                    <p className="text-sm text-slate-500 mb-4">Reveal the category of the current word.</p>
                  </div>
                  <button 
                    onClick={() => buyPowerup('reveal')}
                    className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Coins size={16} /> 300
                  </button>
                </div>

                <div className="p-6 rounded-2xl border-2 border-rose-50 bg-rose-50/30 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600">
                        <Play size={24} />
                      </div>
                      <div className="bg-rose-600 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase">
                        Owned: {userInventory.skip}
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Skip Word</h3>
                    <p className="text-sm text-slate-500 mb-4">Get a new word if you're the drawer.</p>
                  </div>
                  <button 
                    onClick={() => buyPowerup('skip')}
                    disabled={currentRoom && currentRoom.status === 'playing' && user.uid !== currentRoom.currentDrawerId}
                    className="w-full bg-rose-600 text-white py-3 rounded-xl font-bold hover:bg-rose-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Coins size={16} /> 250
                  </button>
                </div>
              </div>

              {!currentRoom && (
                <p className="mt-6 text-center text-sm text-slate-400 italic">
                  Power-ups purchased here will be added to your inventory for future games.
                </p>
              )}
            </div>
          </motion.div>
        )}

        {view === 'settings' && (
          <motion.div 
            key="settings"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-2xl mx-auto pt-20 px-4"
          >
            <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-black text-slate-900 italic uppercase">Settings</h2>
                <button 
                  onClick={() => {
                    setShowInfo(false);
                    setView(previousView);
                  }}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-6">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Audio Settings</h3>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                        <Music size={20} />
                      </div>
                      <div>
                        <div className="font-bold text-slate-700">Background Music</div>
                        <div className="text-xs text-slate-400">Toggle ambient game music</div>
                      </div>
                    </div>
                    <button 
                      onClick={toggleBgm}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        isBgmEnabled ? "bg-indigo-600" : "bg-slate-300"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        isBgmEnabled ? "right-1" : "left-1"
                      )} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold text-slate-400 uppercase">
                      <span>Music Volume</span>
                      <span>{Math.round(bgmVolume * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.05" 
                      value={bgmVolume} 
                      onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold text-slate-400 uppercase">
                      <span>SFX Volume</span>
                      <span>{Math.round(sfxVolume * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.05" 
                      value={sfxVolume} 
                      onChange={(e) => setSfxVolume(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Application</h3>
                  <button 
                    onClick={() => {
                      setShowInfo(!showInfo);
                      playSound(SOUNDS.CLICK);
                    }}
                    className="w-full flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                        <Info size={20} />
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-slate-700 group-hover:text-indigo-600 transition-colors">App Info</div>
                        <div className="text-xs text-slate-400">Version, credits and how to play</div>
                      </div>
                    </div>
                    <div className={cn("transition-transform duration-300", showInfo ? "rotate-180" : "")}>
                      <Plus size={20} className="text-slate-300" />
                    </div>
                  </button>

                  <a 
                    href="https://profileddteam.carrd.co" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-between group mt-4 pt-4 border-t border-slate-200"
                    onClick={() => playSound(SOUNDS.CLICK)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600">
                        <Heart size={20} fill="currentColor" />
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-slate-700 group-hover:text-rose-600 transition-colors">About Us</div>
                        <div className="text-xs text-slate-400">Visit our team profile</div>
                      </div>
                    </div>
                    <ExternalLink size={20} className="text-slate-300 group-hover:text-rose-400 transition-colors" />
                  </a>

                  <AnimatePresence>
                    {showInfo && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-6 mt-6 border-t border-slate-200 space-y-4">
                          <div>
                            <h4 className="text-xs font-black text-slate-900 uppercase mb-2">About Zoodle</h4>
                            <p className="text-sm text-slate-500 leading-relaxed">
                              Zoodle is a real-time multiplayer drawing and guessing game. Express your creativity, guess words, and climb the leaderboard!
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <h4 className="text-xs font-black text-slate-900 uppercase mb-1">Version</h4>
                              <p className="text-sm text-slate-500">2.1.0-stable</p>
                            </div>
                            <div>
                              <h4 className="text-xs font-black text-slate-900 uppercase mb-1">Engine</h4>
                              <p className="text-sm text-slate-500">React + Firebase</p>
                            </div>
                          </div>
                          <div>
                            <h4 className="text-xs font-black text-slate-900 uppercase mb-2">How to Play</h4>
                            <ul className="text-sm text-slate-500 space-y-1 list-disc pl-4">
                              <li>Join or create a room with friends.</li>
                              <li>When it's your turn, draw the assigned word.</li>
                              <li>Others guess the word in the chat.</li>
                              <li>Earn points for correct guesses and good drawings!</li>
                            </ul>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-slate-100 text-center">
                <p className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em]">
                  Made with ❤️ for the Zoodle Community
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {view === 'landing' && (
          <motion.div 
            key="landing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="max-w-4xl mx-auto pt-20 px-4"
          >
            <div className="text-center mb-12">
              <h1 className="text-6xl font-black text-slate-900 mb-4 italic tracking-tighter">ZOODLE</h1>
              <div className="flex items-center justify-center gap-6">
                <div className="flex items-center gap-4 text-slate-500 font-medium">
                  <button 
                    onClick={() => {
                      setPreviousView('landing');
                      setView('profile');
                      playSound(SOUNDS.CLICK);
                    }}
                    className="flex items-center gap-2 hover:text-indigo-600 transition-colors"
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} className="w-8 h-8 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
                    ) : (
                      <UserIcon size={20} />
                    )}
                    <span className="font-bold">{playerName}</span>
                  </button>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div className="flex items-center gap-2">
                  <button 
                    onClick={toggleBgm}
                    className={cn(
                      "p-2 rounded-full border transition-all",
                      isBgmEnabled ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-slate-200 text-slate-400"
                    )}
                    title={isBgmEnabled ? "Disable Background Music" : "Enable Background Music"}
                  >
                    <Music size={18} className={isBgmEnabled ? "animate-bounce" : ""} />
                  </button>
                  <button 
                    onClick={() => {
                      setPreviousView('landing');
                      setView('settings');
                      playSound(SOUNDS.CLICK);
                    }}
                    className="p-2 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm"
                    title="Settings"
                  >
                    <Settings size={18} />
                  </button>
                  <button 
                    onClick={() => {
                      setPreviousView('landing');
                      setView('shop');
                      playSound(SOUNDS.CLICK);
                    }}
                    className="bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2"
                  >
                    <ShoppingBag size={18} className="text-indigo-600" />
                    <span className="text-sm font-bold">Shop</span>
                  </button>
                  <div className="bg-yellow-50 px-4 py-2 rounded-full border border-yellow-100 flex items-center gap-2 shadow-sm">
                    <Coins size={20} className="text-yellow-500" />
                    <span className="font-black text-yellow-700 text-lg">{userCoins}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200">
              <div className="mb-8">
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Your Nickname</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter a cool name..."
                    className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-lg font-bold focus:border-indigo-500 focus:outline-none transition-colors"
                  />
                  <button 
                    onClick={() => updatePlayerName(playerName)}
                    className="bg-indigo-600 text-white px-6 rounded-2xl font-bold hover:bg-indigo-700 transition-all"
                  >
                    Save
                  </button>
                </div>
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
                      <div key={p.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col items-center gap-2 relative group">
                        <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                          <UserIcon size={24} />
                        </div>
                        {p.id === user.uid ? (
                          <div className="flex items-center gap-1 w-full">
                            <input 
                              type="text" 
                              value={playerName}
                              onChange={(e) => setPlayerName(e.target.value)}
                              onBlur={() => updatePlayerName(playerName)}
                              onKeyDown={(e) => e.key === 'Enter' && updatePlayerName(playerName)}
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-center focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        ) : (
                          <span className="font-bold text-slate-700 truncate w-full text-center">{p.name}</span>
                        )}
                        {p.isHost && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold uppercase">Host</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col justify-end gap-4">
                  {currentRoom.hostId === user.uid ? (
                    <div className="flex flex-col gap-2">
                      <button 
                        onClick={startGame}
                        className="w-full bg-indigo-600 text-white p-6 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg"
                      >
                        Start Game
                      </button>
                      {players.length < 3 && (
                        <button 
                          onClick={async () => {
                            setLoading(true);
                            try {
                              const botId = `bot_${Math.random().toString(36).substr(2, 9)}`;
                              await setDoc(doc(db, 'rooms', currentRoom.id, 'players', botId), {
                                name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
                                score: 0,
                                coins: 0,
                                isReady: true,
                                isHost: false,
                                isBot: true,
                                lastActive: new Date().toISOString()
                              });
                              showToast('Bot added!');
                            } catch (e) {
                              console.error(e);
                            } finally {
                              setLoading(false);
                            }
                          }}
                          className="w-full bg-amber-50 text-amber-600 p-3 rounded-xl font-bold border border-amber-100 hover:bg-amber-100 transition-all flex items-center justify-center gap-2"
                        >
                          <Plus size={16} />
                          Add AI Bot
                        </button>
                      )}
                    </div>
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
                      {currentRoom.currentWord.split('').map((c, i) => (c === ' ' ? ' ' : (revealedLetters[i] || '_'))).join(' ')}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                <button 
                  onClick={() => {
                    setPreviousView('game');
                    setView('shop');
                  }}
                  className="bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2"
                >
                  <ShoppingBag size={18} className="text-indigo-600" />
                  <span className="text-sm font-bold">Shop</span>
                </button>
                <div className="bg-yellow-50 px-4 py-2 rounded-full border border-yellow-100 flex items-center gap-2">
                  <Coins size={16} className="text-yellow-500" />
                  <span className="font-bold text-yellow-700">{players.find(p => p.id === user.uid)?.coins || 0}</span>
                </div>
              </div>
            </div>

            {/* Game Body */}
            <div className="flex-1 flex gap-4 overflow-hidden">
                {/* Sidebar Left */}
                <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
                  <PlayerList players={players} currentDrawerId={currentRoom.currentDrawerId} />
                  
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Inventory</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => usePowerup('freeze')}
                        disabled={userInventory.freeze <= 0}
                        className="p-2 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all flex flex-col items-center gap-1 disabled:opacity-50"
                      >
                        <Clock size={16} />
                        <span className="text-[10px] font-black">{userInventory.freeze}</span>
                      </button>
                      <button 
                        onClick={() => usePowerup('hint')}
                        disabled={userInventory.hint <= 0}
                        className="p-2 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all flex flex-col items-center gap-1 disabled:opacity-50"
                      >
                        <Zap size={16} />
                        <span className="text-[10px] font-black">{userInventory.hint}</span>
                      </button>
                      <button 
                        onClick={() => usePowerup('reveal')}
                        disabled={userInventory.reveal <= 0}
                        className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all flex flex-col items-center gap-1 disabled:opacity-50"
                      >
                        <Palette size={16} />
                        <span className="text-[10px] font-black">{userInventory.reveal}</span>
                      </button>
                      <button 
                        onClick={() => usePowerup('skip')}
                        disabled={userInventory.skip <= 0 || user.uid !== currentRoom.currentDrawerId}
                        className="p-2 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all flex flex-col items-center gap-1 disabled:opacity-50"
                      >
                        <Play size={16} />
                        <span className="text-[10px] font-black">{userInventory.skip}</span>
                      </button>
                    </div>
                  </div>

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

              <div className="mb-6 text-slate-400 text-sm font-medium">
                Returning to home in <span className="text-indigo-600 font-bold">{resultsCountdown}s</span>...
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
            className={cn(
              "fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl font-bold text-white z-50 flex items-center gap-2",
              toast.type === 'success' ? "bg-emerald-500" : "bg-rose-500"
            )}
          >
            {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            {toast.message}
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
