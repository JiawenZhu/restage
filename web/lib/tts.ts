import { GoogleAuth } from 'google-auth-library';

export interface TTSOptions {
  text: string;
  voiceName?: string;
  languageCode?: string;
  speakingRate?: number;
  pitch?: number;
  audioEncoding?: 'LINEAR16' | 'MP3' | 'OGG_OPUS';
  sampleRateHertz?: number;
}

let googleAuthClient: GoogleAuth | null = null;

function getAuth() {
  if (googleAuthClient) return googleAuthClient;

  const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required for Google Cloud TTS');
  }

  const credentials = JSON.parse(rawKey);
  googleAuthClient = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return googleAuthClient;
}

/**
 * Synthesizes natural spoken narration using Google Cloud TTS Chirp 3-HD / Journey voices.
 * Returns raw Buffer of the audio (e.g. 24kHz WAV or MP3).
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<Buffer> {
  const {
    text,
    voiceName = 'en-US-Chirp3-HD-Aoede',
    languageCode = 'en-US',
    speakingRate = 1.0,
    pitch = 0.0,
    audioEncoding = 'LINEAR16',
    sampleRateHertz = 24000,
  } = options;

  const auth = getAuth();
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const endpoint = 'https://texttospeech.googleapis.com/v1/text:synthesize';

  const payload = {
    input: { text },
    voice: {
      languageCode,
      name: voiceName,
    },
    audioConfig: {
      audioEncoding,
      speakingRate,
      pitch,
      sampleRateHertz,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google Cloud TTS failed (${res.status}): ${data?.error?.message ?? JSON.stringify(data)}`);
  }

  if (!data.audioContent) {
    throw new Error('No audio content returned from Google Cloud TTS');
  }

  return Buffer.from(data.audioContent, 'base64');
}
