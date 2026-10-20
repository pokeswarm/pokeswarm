import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase の Web アプリの設定値（.env.local の VITE_FIREBASE_*）。
 * 公開してよい値だが、環境ごとに切り替えられるよう環境変数から読む。無ければ null。
 * Firebase 本体を読み込まずに判定できるよう、app.ts とは分けている。
 */
export function firebaseOptionsFromEnv(): FirebaseOptions | null {
  const env = import.meta.env;
  const options: FirebaseOptions = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  return options.apiKey && options.databaseURL && options.appId ? options : null;
}
