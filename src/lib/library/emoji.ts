/** Animated Noto Emoji (Google, CC BY 4.0) as Lottie animations, downloaded by setup:library. */
export interface EmojiAsset {
  name: string;
  code: string; // codepoint(s) in hex, joined with "_"
  char: string;
  tags: string[];
}

const e = (name: string, code: string, char: string, tags: string[]): EmojiAsset => ({ name, code, char, tags });

export const EMOJIS: EmojiAsset[] = [
  e("fire", "1f525", "🔥", ["hot", "trending", "lit", "sale"]),
  e("joy", "1f602", "😂", ["laugh", "funny", "meme"]),
  e("rofl", "1f923", "🤣", ["laugh", "funny", "meme"]),
  e("heart-eyes", "1f60d", "😍", ["love", "wow", "food"]),
  e("star-struck", "1f929", "🤩", ["wow", "amazing"]),
  e("mind-blown", "1f92f", "🤯", ["shock", "wow", "meme"]),
  e("scream", "1f631", "😱", ["shock", "omg", "meme"]),
  e("sob", "1f62d", "😭", ["cry", "emotional", "meme"]),
  e("cool", "1f60e", "😎", ["cool", "swag"]),
  e("partying", "1f973", "🥳", ["party", "celebrate", "birthday"]),
  e("thinking", "1f914", "🤔", ["question", "hmm"]),
  e("eyes", "1f440", "👀", ["look", "watch", "attention"]),
  e("drooling", "1f924", "🤤", ["food", "yummy", "tasty"]),
  e("yum", "1f60b", "😋", ["food", "tasty", "delicious"]),
  e("wink", "1f609", "😉", ["wink", "playful"]),
  e("smiling", "1f60a", "😊", ["happy", "smile"]),
  e("grinning", "1f600", "😀", ["happy", "smile"]),
  e("shushing", "1f92b", "🤫", ["secret", "quiet"]),
  e("money-mouth", "1f911", "🤑", ["money", "rich", "offer"]),
  e("skull", "1f480", "💀", ["dead", "funny", "meme"]),
  e("clap", "1f44f", "👏", ["applause", "well-done"]),
  e("thumbs-up", "1f44d", "👍", ["like", "ok", "good"]),
  e("ok-hand", "1f44c", "👌", ["perfect", "ok"]),
  e("pray", "1f64f", "🙏", ["thanks", "please", "namaste"]),
  e("muscle", "1f4aa", "💪", ["strong", "gym", "fitness"]),
  e("wave", "1f44b", "👋", ["hello", "hi", "bye"]),
  e("raised-hands", "1f64c", "🙌", ["celebrate", "yay"]),
  e("point-down", "1f447", "👇", ["below", "link", "comment"]),
  e("red-heart", "2764_fe0f", "❤️", ["love", "like"]),
  e("sparkling-heart", "1f496", "💖", ["love", "cute"]),
  e("hundred", "1f4af", "💯", ["perfect", "100", "best"]),
  e("sparkles", "2728", "✨", ["new", "magic", "shine"]),
  e("star", "2b50", "⭐", ["rating", "best"]),
  e("glowing-star", "1f31f", "🌟", ["special", "shine"]),
  e("party-popper", "1f389", "🎉", ["celebrate", "offer", "launch"]),
  e("confetti", "1f38a", "🎊", ["celebrate", "party"]),
  e("rocket", "1f680", "🚀", ["launch", "growth", "fast"]),
  e("collision", "1f4a5", "💥", ["boom", "impact", "explosion"]),
  e("zap", "26a1", "⚡", ["fast", "power", "energy"]),
  e("rainbow", "1f308", "🌈", ["colorful", "happy"]),
  e("gift", "1f381", "🎁", ["gift", "offer", "festival"]),
  e("balloon", "1f388", "🎈", ["birthday", "party"]),
  e("money-wings", "1f4b8", "💸", ["spend", "sale", "discount"]),
  e("bell", "1f514", "🔔", ["notification", "subscribe"]),
  e("check-mark", "2705", "✅", ["done", "yes", "correct"]),
  e("cross-mark", "274c", "❌", ["no", "wrong", "dont"]),
  e("warning", "26a0_fe0f", "⚠️", ["alert", "careful"]),
  e("alarm-clock", "23f0", "⏰", ["time", "limited", "hurry"]),
  e("hourglass", "23f3", "⏳", ["waiting", "time"]),
  e("light-bulb", "1f4a1", "💡", ["idea", "tip"]),
  e("music-notes", "1f3b6", "🎶", ["music", "song"]),
  e("camera-flash", "1f4f8", "📸", ["photo", "camera"]),
  e("trophy", "1f3c6", "🏆", ["win", "best", "champion"]),
  e("crown", "1f451", "👑", ["king", "queen", "premium"]),
  e("diamond", "1f48e", "💎", ["premium", "luxury"]),
  e("cake", "1f382", "🎂", ["birthday", "celebrate", "bakery"]),
  e("coffee", "2615", "☕", ["cafe", "morning"]),
  e("pizza", "1f355", "🍕", ["food", "restaurant"]),
  e("diya", "1fa94", "🪔", ["diwali", "deepavali", "festival"]),
];

export function emojiFile(code: string) {
  return `emoji/${code}.json`;
}
