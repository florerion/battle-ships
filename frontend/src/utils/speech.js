export function speakWord(word) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'pl-PL';
  utterance.rate = 0.9;
  utterance.pitch = 1;

  const voices = window.speechSynthesis.getVoices();
  const polishVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith('pl'));
  if (polishVoice) {
    utterance.voice = polishVoice;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
