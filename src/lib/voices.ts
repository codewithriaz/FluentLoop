/** English voices of Kokoro-82M v1.0 (must match VOICES in src-tauri/src/commands/tts.rs). */
export interface Voice {
  id: string;
  name: string;
  accent: "American" | "British";
  gender: "Female" | "Male";
}

const IDS = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
];

export const DEFAULT_VOICE = "af_heart";

export function voiceInfo(id: string): Voice {
  const name = id.split("_")[1] ?? id;
  return {
    id,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    accent: id.startsWith("b") ? "British" : "American",
    gender: id[1] === "m" ? "Male" : "Female",
  };
}

export const VOICES: Voice[] = IDS.map(voiceInfo);

export const VOICE_GROUPS: { label: string; voices: Voice[] }[] = [
  { label: "American · Female", voices: VOICES.filter((v) => v.accent === "American" && v.gender === "Female") },
  { label: "American · Male", voices: VOICES.filter((v) => v.accent === "American" && v.gender === "Male") },
  { label: "British · Female", voices: VOICES.filter((v) => v.accent === "British" && v.gender === "Female") },
  { label: "British · Male", voices: VOICES.filter((v) => v.accent === "British" && v.gender === "Male") },
];
