import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const LoadingScreen = ({ progress, text }) => {
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
            src="https://i.imgur.com/8N6y8N6.png" 
            alt="Dev Duo Logo" 
            className="w-48 h-48 rounded-3xl shadow-2xl relative z-10 border-4 border-white/20"
            referrerPolicy="no-referrer"
          />
        </motion.div>

        <h1 className="text-4xl font-black mb-8 text-center italic tracking-tighter">ZOODLE</h1>
        
        <div className="w-full mb-2 flex justify-between items-end">
          <span className="text-sm font-bold uppercase tracking-widest opacity-80">Loading...</span>
          <span className="text-2xl font-black">{Math.floor(progress)}%</span>
        </div>
        
        <div className="w-full h-3 bg-indigo-800 rounded-full overflow-hidden mb-4 shadow-inner">
          <motion.div 
            className="h-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.5)]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', bounce: 0, duration: 0.2 }}
          />
        </div>
        
        <p className="text-center text-indigo-200 font-medium animate-pulse">
          {text}
        </p>
      </div>
    </div>
  );
};

export default LoadingScreen;
