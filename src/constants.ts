export const WORD_LIST = [
  'apple', 'banana', 'cat', 'dog', 'elephant', 'fish', 'guitar', 'house', 'ice cream', 'jacket',
  'kangaroo', 'lion', 'mountain', 'notebook', 'orange', 'pizza', 'queen', 'rabbit', 'sun', 'tree',
  'umbrella', 'violin', 'whale', 'xylophone', 'yacht', 'zebra', 'airplane', 'bicycle', 'car', 'door',
  'egg', 'flower', 'glasses', 'hat', 'island', 'juice', 'key', 'lamp', 'moon', 'nose',
  'ocean', 'pencil', 'quilt', 'rocket', 'star', 'train', 'unicorn', 'vase', 'window', 'yo-yo'
];

export const THEME_WORDS = {
  space: ['astronaut', 'planet', 'galaxy', 'telescope', 'alien', 'ufo', 'satellite', 'asteroid', 'comet', 'black hole'],
  nature: ['waterfall', 'volcano', 'rainbow', 'forest', 'desert', 'cactus', 'mushroom', 'butterfly', 'spider', 'river'],
  food: ['hamburger', 'sushi', 'taco', 'pancake', 'donut', 'broccoli', 'watermelon', 'cheese', 'cupcake', 'spaghetti']
};

export const MODE_CONFIG = {
  classic: {
    roundTime: 60,
    totalRounds: 3,
    pointsMultiplier: 1
  },
  theme: {
    roundTime: 80, // More complex words, more time
    totalRounds: 3,
    pointsMultiplier: 1.5
  },
  speed: {
    roundTime: 20, // Very fast
    totalRounds: 5,
    pointsMultiplier: 2
  }
};

export const ROUND_TIME = 60; // Default fallback
export const TOTAL_ROUNDS = 3;
export const POINTS_PER_GUESS = 100;
export const COINS_PER_GUESS = 10;
