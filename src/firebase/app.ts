import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { firebaseOptionsFromEnv } from './config';

export interface FirebaseHandles {
  db: Database;
  /** ログイン中のユーザー ID（ゲストなら匿名ログインのもの） */
  uid: string;
}

/** Firebase のアプリ（1つだけ作って使い回す）。設定値が無ければエラー */
export function firebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  const options = firebaseOptionsFromEnv();
  if (!options) throw new Error('Firebase の設定値がありません（.env.local）');
  return initializeApp(options);
}

/** 協力プレイの接続用: ログイン中のユーザーで Realtime Database を使う。まだなら匿名ログインする */
export async function connectFirebase(): Promise<FirebaseHandles> {
  const app = firebaseApp();
  const auth = getAuth(app);
  await auth.authStateReady();
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
  return { db: getDatabase(app), uid: user.uid };
}
